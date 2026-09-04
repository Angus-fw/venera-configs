/** @type {import('./_venera_.js')} */
/*
 * 漫蛙漫画 (mwuu.cc / manwari.cc) — Venera 漫画源
 *
 * mwuu.cc 是入口域名, 内容托管于 manwari.cc。全部走 JSON API (/api):
 * - 首页  GET  /api/home
 * - 搜索  GET  /api/search?keyword=&type=mh&page=&pageSize=
 * - 分类  POST /api/cate/{tag}  body {"page":{"page":N,"pageSize":M},"category":"comic","tag":tag}
 * - 详情  GET  /api/comic/{id}
 * - 章节  GET  /api/comic/chapter?comicId=&page=&pageSize=   -> {data:[...], pagination:{total}}
 * - 图片  GET  /api/comic/image/{chapterId}                 -> {data:{images:[{url}]}}
 *
 * 重要: 图床 (tu.mhttu.cc / mwtuyi.cc 等) 的所有图片均被 AES-CBC 加密(站点 JS
 * BaseUtil.AES_KEY), 阅读器 fetch 字节后解密再显示。Venera 无法直接解码加密字节,
 * 需经 comic.onImageLoad / comic.onThumbnailLoad 的 onResponse 在拿到字节后解密:
 *   明文头(JPEG/PNG/GIF/WebP) 则直通; 否则 iv=前16字节, AES-256-CBC 解密。
 */

const MW_AES_KEY = "0B6666A0-BB59-1381-B746-a0E4C9AC";

/// 解密图片响应字节 (ArrayBuffer -> ArrayBuffer)
function mwDecryptImageBuffer(buffer) {
    if (!buffer || buffer.byteLength <= 16) return buffer;
    let view = new Uint8Array(buffer);
    // 已是明文图片则直通
    let b0 = view[0], b1 = view[1];
    let plain =
        (b0 === 0xff && b1 === 0xd8) || // jpeg
        (b0 === 0x89 && b1 === 0x50) || // png
        (b0 === 0x47 && b1 === 0x49) || // gif
        (b0 === 0x52 && b1 === 0x49);   // RIFF (webp)
    if (plain) return buffer;
    if ((buffer.byteLength - 16) % 16 !== 0) return buffer; // 非预期数据, 原样返回
    try {
        let iv = buffer.slice(0, 16);
        let cipher = buffer.slice(16);
        let key = Convert.encodeUtf8(MW_AES_KEY).slice(0, 32);
        return Convert.decryptAesCbc(cipher, key, iv);
    } catch (e) {
        return buffer;
    }
}

const MW_TAGS = [
    "热血", "玄幻", "都市", "穿越", "校园", "恋爱", "古风", "后宫",
    "重生", "系统", "搞笑", "悬疑", "科幻", "武侠", "恐怖", "治愈",
    "韩漫", "国漫", "日漫", "BL", "奇幻", "冒险", "竞技",
];

/// 图片 URL 缓存破击: 源更新后旧版本缓存的"加密字节"会命中 Venera 图片缓存,
/// 导致新的解密钩子不生效。加版本 query 使缓存键变化、强制重新下载解密。
function mwCacheBust(url) {
    if (!url || url.indexOf("http") !== 0) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "mv=120";
}

function mwClean(str) {
    if (str == null) return "";
    return String(str)
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

class ManwaComic extends ComicSource {
    // name of the source
    name = "漫蛙漫画";

    // unique id of the source
    key = "mwuu";

    version = "1.2.0";

    minAppVersion = "1.0.0";

    // update url
    url = "https://cdn.jsdelivr.net/gh/Angus-fw/venera-configs@main/mwuu.js";

    /// 用户可切换入口域名
    settings = {
        domain: {
            title: "访问域名",
            type: "select",
            options: [
                { value: "manwari.cc" },
                { value: "mwuu.cc" },
            ],
            default: "manwari.cc",
        },
    };

    init() {
        this._api = () => {
            let d = this.loadSetting("domain") || "manwari.cc";
            return `https://${d}/api`;
        };
        this._headers = {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            referer: "https://manwari.cc/",
        };

        this._getJson = async (url) => {
            let res = await Network.get(url, this._headers);
            if (res.status !== 200) {
                throw `漫蛙 请求失败: ${res.status} ${url}`;
            }
            let json = JSON.parse(res.body);
            if (json.code !== 200) {
                throw `漫蛙 接口错误: code=${json.code} msg=${json.msg || json.message || ""}`;
            }
            return json;
        };

        this._postJson = async (url, payload) => {
            let res = await Network.sendRequest(
                "POST",
                url,
                Object.assign({ "content-type": "application/json" }, this._headers),
                JSON.stringify(payload)
            );
            if (res.status !== 200) {
                throw `漫蛙 请求失败: ${res.status} ${url}`;
            }
            let json = JSON.parse(res.body);
            if (json.code !== 200) {
                throw `漫蛙 接口错误: code=${json.code}`;
            }
            return json;
        };

        /// 通用列表项解析 (兼容 home/search/cate 字段差异)
        this._parseItem = (it) => {
            if (!it) return null;
            let id = it.id != null ? String(it.id) : "";
            if (!id) {
                let m = /\/comic\/(\d+)/.exec(it.url || "");
                if (m) id = m[1];
            }
            if (!id) return null;
            let cover = it.pic || it.cover || "";
            cover = mwCacheBust(cover);
            return new Comic({
                id: id,
                title: mwClean(it.title || ""),
                subTitle: mwClean(it.author || ""),
                cover: cover,
                tags: it.tags ? it.tags.split(",") : undefined,
                description: it.intro || it.description ? mwClean(it.intro || it.description) : undefined,
            });
        };
    }

    // ---------- 首页分区 ----------
    explore = [
        {
            title: "漫蛙",
            type: "singlePageWithMultiPart",
            load: async () => {
                let json = await this._getJson(`${this._api()}/home`);
                let data = json.data || {};
                let parts = {};
                let sections = [
                    ["comicList", "热门推荐"],
                    ["vipList", "VIP专区"],
                    ["gufengList", "最新完整版"],
                    ["xuanhuanList", "最新更新"],
                    ["xiaoyuanList", "热门收藏"],
                ];
                for (let [key, label] of sections) {
                    let list = data[key] || [];
                    let comics = [];
                    for (let it of list) {
                        if (it.type && it.type !== "comic") continue; // 只取漫画
                        let c = this._parseItem(it);
                        if (c) comics.push(c);
                    }
                    if (comics.length > 0 && !parts[label]) {
                        parts[label] = comics;
                    }
                }
                return parts;
            },
        },
    ];

    // ---------- 分类(题材) ----------
    category = {
        title: "漫蛙",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: MW_TAGS.map((t) => ({
                    label: t,
                    target: {
                        page: "category",
                        attributes: { category: t, param: `t${encodeURIComponent(t)}` },
                    },
                })),
            },
        ],
        enableRankingPage: false,
    };

    categoryComics = {
        load: async (category, param, options, page) => {
            let tag = null;
            if (param && param.indexOf("t%") === 0) {
                try { tag = decodeURIComponent(param.slice(1)); } catch (e) { tag = null; }
            }
            if (!tag) tag = category;
            if (MW_TAGS.indexOf(tag) < 0) tag = "热血";

            let pageSize = 24;
            let n = page && page > 0 ? page : 1;
            let json = await this._postJson(
                `${this._api()}/cate/${encodeURIComponent(tag)}`,
                { page: { page: n, pageSize: pageSize }, category: "comic", tag: tag }
            );
            let data = json.data || {};
            let list = data.list || [];
            let comics = [];
            for (let it of list) {
                let c = this._parseItem(it);
                if (c) comics.push(c);
            }
            let total = data.total || 0;
            let maxPage = total > 0 ? Math.ceil(total / pageSize) : 1;
            return { comics: comics, maxPage: maxPage };
        },
    };

    // ---------- 搜索 ----------
    search = {
        load: async (keyword, options, page) => {
            let pageSize = 20;
            let n = page && page > 0 ? page : 1;
            let json = await this._getJson(
                `${this._api()}/search?keyword=${encodeURIComponent(keyword)}&type=mh&page=${n}&pageSize=${pageSize}`
            );
            let data = json.data || {};
            let list = data.list || [];
            let comics = [];
            for (let it of list) {
                let c = this._parseItem(it);
                if (c) comics.push(c);
            }
            let total = data.total || 0;
            let maxPage = total > 0 ? Math.ceil(total / pageSize) : 1;
            return { comics: comics, maxPage: maxPage };
        },
        enableTagsSuggestions: false,
    };

    // ---------- 详情与阅读 ----------
    comic = {
        loadInfo: async (id) => {
            let json = await this._getJson(`${this._api()}/comic/${id}`);
            let d = json.data || {};

            // 章节
            let chapters = new Map();
            let pageJson = await this._getJson(
                `${this._api()}/comic/chapter?comicId=${id}&page=1&pageSize=1`
            );
            let pag = pageJson.pagination || {};
            let total = pag.total || 0;
            if (total > 0) {
                let full = await this._getJson(
                    `${this._api()}/comic/chapter?comicId=${id}&page=1&pageSize=${Math.min(total, 5000)}`
                );
                let list = full.data || [];
                for (let c of list) {
                    if (c.id != null && c.title) {
                        chapters.set(String(c.id), mwClean(c.title));
                    }
                }
            }

            let tags = (d.tags || "").split(",").filter((x) => x.trim());
            let statusText = d.status == 0 ? "连载中" : "已完结";
            let author = mwClean(d.author || "");

            let details = {
                title: mwClean(d.title || id),
                subTitle: author,
                cover: mwCacheBust(d.cover || ""),
                description: mwClean(d.intro || ""),
                tags: {
                    状态: [statusText],
                },
                chapters: chapters,
            };
            if (author) details.tags["作者"] = [author];
            if (tags.length > 0) details.tags["类型"] = tags;
            if (d.editTime) {
                let dt = new Date(d.editTime * 1000);
                details.updateTime = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
            }
            if (chapters.size === 0) {
                throw "漫蛙 未找到章节";
            }
            return new ComicDetails(details);
        },

        loadEp: async (comicId, epId) => {
            let json = await this._getJson(`${this._api()}/comic/image/${epId}`);
            let data = json.data || {};
            let list = (data.images || []).filter((i) => i && i.url);
            if (list.length === 0) {
                throw "漫蛙 本章无可用图片";
            }
            let images = [];
            for (let i of list) {
                let u = mwCacheBust(i.url);
                if (u.indexOf("http") !== 0 && u.indexOf("//") === 0) u = "https:" + u;
                if (images.indexOf(u) < 0) images.push(u);
            }
            return { images: images };
        },

        /// 阅读图/封面图都经过 AES 加密, 取到字节后解密
        onImageLoad: (url, comicId, epId) => ({
            url: url,
            headers: { referer: "https://manwari.cc/", "user-agent": "Mozilla/5.0" },
            onResponse: (buffer) => mwDecryptImageBuffer(buffer),
        }),
        onThumbnailLoad: (url) => ({
            url: url,
            headers: { referer: "https://manwari.cc/", "user-agent": "Mozilla/5.0" },
            onResponse: (buffer) => mwDecryptImageBuffer(buffer),
        }),

        // 粘贴纯数字作品 id 即可识别
        idMatch: "^\\d+$",

        link: {
            domains: ["mwuu.cc", "manwari.cc"],
            linkToId: (url) => {
                let m = /\/comic\/(\d+)/.exec(url);
                return m ? m[1] : null;
            },
        },

        enableTagsTranslate: false,
    };
}
