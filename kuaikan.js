/** @type {import('./_venera_.js')} */
/*
 * 快看漫画 (www.kuaikanmanhua.com) — Venera 漫画源
 *
 * 数据来源:
 * - 系列详情:  GET /v2/pweb/topic/{topicId}
 *              -> data.topic_info (含 title/cover/简介/tags/作者/状态/comics[])
 * - 阅读:      GET /v2/pweb/comic/inner/{comicId}  (comicId=某一话的 id)
 *              -> data.comic_info.comic_images[].url  (签名图链, JPEG)
 * - 排行/分类: Nuxt SSR 页 (ranking / tag/{id}) 内嵌 window.__NUXT__ 数据,
 *              提取后 eval 还原为对象再解析列表与标签。
 */

const KK_SITE = "https://www.kuaikanmanhua.com";

/// 题材标签 (id, 显示名) — 取自分类页 /tag/0/ 的 tagList
const KK_TAGS = [
    [0, "全部"], [20, "恋爱"], [46, "古风"], [77, "大女主"], [80, "穿越"],
    [74, "校园"], [63, "玄幻"], [52, "总裁"], [65, "悬疑"], [92, "非人类"],
    [81, "恐怖"], [68, "异能"], [22, "奇幻"], [86, "系统"], [89, "重生"],
    [91, "末世"], [48, "都市"], [67, "热血"], [23, "剧情"], [62, "萌系"],
    [71, "搞笑"], [85, "武侠"], [54, "正能量"],
];

function kkClean(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/// 从 Nuxt SSR 页面 HTML 还原出 data[0] 数据
function kkNuxtData(html) {
    let i = html.indexOf("window.__NUXT__=");
    if (i < 0) {
        throw "快看 无法解析页面数据";
    }
    let j = html.indexOf("</script>", i);
    if (j < 0) {
        throw "快看 无法解析页面数据";
    }
    let code = html.slice(html.indexOf("=", i) + 1, j).trim();
    code = code.replace(/;\s*$/, "");
    let nuxt = eval("(" + code + ")");
    if (!nuxt || !nuxt.data || !nuxt.data[0]) {
        throw "快看 页面数据为空";
    }
    return nuxt.data[0];
}

/// 通用作品项 -> Comic (排名与分类的数据结构基本一致)
function kkTopicToComic(o) {
    if (!o || o.id == null) return null;
    let author = o.author_name || (o.user && o.user.nickname) || "";
    let tagsArr = Array.isArray(o.category) ? o.category
        : (Array.isArray(o.tags) ? o.tags.map((t) => (t && t.title) ? t.title : t) : undefined);
    return new Comic({
        id: String(o.id),
        title: kkClean(o.title || ""),
        subTitle: kkClean(author),
        cover: o.cover_image_url || o.image_url || "",
        tags: tagsArr,
        description: o.description ? kkClean(o.description) : undefined,
    });
}

class Kuaikan extends ComicSource {
    name = "快看漫画";
    key = "kuaikan";
    version = "1.0.3";
    minAppVersion = "1.0.0";

    /// 更新地址 (你的 fork 仓库)
    url = "https://cdn.jsdelivr.net/gh/Angus-fw/venera-configs@main/kuaikan.js";

    /// VIP/付费解锁: 在电脑浏览器登录快看(VIP)后, 把请求头 Cookie 粘贴到这里,
    /// 锁章也会返回全量图(与 10Comic 同原理: 带会话请求章节数据)。
    settings = {
        cookie: {
            title: "Cookie (VIP可选)",
            type: "input",
            default: "",
        },
    };

    // ---------- 账号: 内置浏览器自动登录 (VIP解锁) ----------
    account = {
        loginWithWebview: {
            url: KK_SITE + "/webs/loginh",
            checkStatus: (url, title) => {
                // 离开登录页即视为登录成功(会话 Cookie 由引擎自动保存)
                return url.indexOf("kuaikanmanhua.com") >= 0
                    && url.indexOf("loginh") < 0
                    && url.indexOf("/login") < 0;
            },
        },
        logout: () => {
            Network.deleteCookies(KK_SITE);
        },
    };

    init() {
        this._headers = {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            referer: KK_SITE + "/",
        };
        let cookie = this.loadSetting("cookie");
        if (cookie) {
            this._headers.cookie = cookie;
        }

        this._get = async (url) => {
            let res = await Network.get(url, this._headers);
            if (res.status !== 200) {
                throw `快看 请求失败: ${res.status} ${url}`;
            }
            return res.body;
        };
    }

    // ---------- 探索: 排行榜 (一个页面内含全部榜单) ----------
    explore = [
        {
            title: "排行榜",
            type: "singlePageWithMultiPart",
            load: async () => {
                let html = await this._get(`${KK_SITE}/ranking/`);
                let d0 = kkNuxtData(html);
                let boards = d0.rankLists || [];
                let parts = {};
                for (let b of boards) {
                    let list = b.list || [];
                    let comics = [];
                    for (let o of list) {
                        let c = kkTopicToComic(o);
                        if (c) comics.push(c);
                    }
                    if (comics.length > 0) {
                        parts[b.title || "排行"] = comics;
                    }
                }
                return parts;
            },
        },
    ];

    // ---------- 分类(题材) ----------
    category = {
        title: "快看",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: KK_TAGS.map(([id, label]) => ({
                    label: label,
                    target: {
                        page: "category",
                        attributes: {
                            category: label,
                            param: `t${id}`,
                        },
                    },
                })),
            },
        ],
        enableRankingPage: false,
    };

    categoryComics = {
        load: async (category, param, options, page) => {
            let tagId = "0";
            if (param) {
                let m = /^t(\d+)$/.exec(param);
                if (m) tagId = m[1];
            }
            let n = page && page > 0 ? page : 1;
            let url = `${KK_SITE}/tag/${tagId}/?region=1&pays=0&state=0&sort=1&page=${n}`;
            let html = await this._get(url);
            let d0 = kkNuxtData(html);
            let list = d0.dataList || [];
            let comics = [];
            for (let o of list) {
                let c = kkTopicToComic(o);
                if (c) comics.push(c);
            }
            let total = d0.total || 0;
            let pageSize = list.length || 1;
            let maxPage = total > 0 ? Math.ceil(total / pageSize) : 1;
            return { comics: comics, maxPage: maxPage };
        },
    };

    // ---------- 搜索 ----------
    // 快看网页端暂无公开搜索接口, 占位以避免解析器深访问报错
    search = {
        load: async (keyword, options, page) => {
            return { comics: [], maxPage: 1 };
        },
        enableTagsSuggestions: false,
    };

    // ---------- 详情与阅读 ----------
    comic = {
        loadInfo: async (id) => {
            let json;
            let body = await this._get(`${KK_SITE}/v2/pweb/topic/${id}`);
            try {
                json = JSON.parse(body);
            } catch (e) {
                throw "快看 详情接口异常";
            }
            if (!json || json.code !== 200 || !json.data || !json.data.topic_info) {
                throw `快看 详情失败: ${(json && json.message) || ""}`;
            }
            let info = json.data.topic_info;

            // 标签: tags 可能是 [string] 或 [{id,title}]
            let tagTexts = [];
            if (Array.isArray(info.tags)) {
                for (let t of info.tags) {
                    let s = (typeof t === "string") ? t : (t && t.title);
                    if (s) tagTexts.push(kkClean(s));
                }
            }

            // 章节: comics 已按第1话~最新 升序返回
            let chapters = new Map();
            let comics = info.comics || [];
            for (let c of comics) {
                if (c.id != null && c.title) {
                    chapters.set(String(c.id), kkClean(c.title));
                }
            }
            if (chapters.size === 0) {
                throw "快看 未找到章节";
            }

            let author = (info.user && info.user.nickname) || "";
            let statusText = kkClean(info.update_status || "");
            let tags = {};
            if (author) tags["作者"] = [author];
            if (statusText) tags["状态"] = [statusText];
            if (tagTexts.length > 0) tags["类型"] = tagTexts;

            return new ComicDetails({
                title: kkClean(info.title || id),
                subTitle: author,
                cover: info.cover_image_url || info.vertical_image_url || "",
                description: kkClean(info.description || ""),
                tags: tags,
                chapters: chapters,
            });
        },

        loadEp: async (comicId, epId) => {
            let body = await this._get(`${KK_SITE}/v2/pweb/comic/inner/${epId}`);
            let json;
            try {
                json = JSON.parse(body);
            } catch (e) {
                throw "快看 章节数据异常";
            }
            if (!json || json.code !== 200) {
                throw `快看 章节不可读: ${(json && json.message) || ""}`;
            }
            let comicInfo = (json.data && json.data.comic_info) || {};
            let imgs = (comicInfo.comic_images || [])
                .filter((x) => x && x.url)
                .map((x) => x.url);
            if (imgs.length === 0) {
                throw "快看 本章为付费/VIP 内容: 请在源设置填写已登录快看网页的 Cookie 后重试";
            }
            return { images: imgs };
        },

        /// 图片请求带上会话(部分签名图需登录态)
        onImageLoad: (url, comicId, epId) => {
            let h = { referer: KK_SITE + "/" };
            let c = this.loadSetting("cookie");
            if (c) h.cookie = c;
            return { url: url, headers: h };
        },
        onThumbnailLoad: (url) => {
            let h = { referer: KK_SITE + "/" };
            let c = this.loadSetting("cookie");
            if (c) h.cookie = c;
            return { url: url, headers: h };
        },

        // 粘贴纯数字 topic id 即可识别
        idMatch: "^\\d+$",

        link: {
            domains: ["kuaikanmanhua.com", "kkmh.com"],
            linkToId: (url) => {
                let m = /\/web\/topic\/(\d+)/.exec(url);
                return m ? m[1] : null;
            },
        },

        enableTagsTranslate: false,
    };
}
