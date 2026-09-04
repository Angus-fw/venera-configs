/** @type {import('./_venera_.js')} */
/*
 * 腾讯动漫 (ac.qq.com) — Venera 漫画源
 *
 * - 作品:  /Comic/comicInfo/id/{id}
 * - 章节:  阅读页 /ComicView/index/id/{id}/cid/{cid} 内联 var DATA='...'（base64 混淆）
 *   与 window["no"+"nce"]/window["n"+"once"]（nonce）。解码:
 *   按 nonce 的 \d+[a-zA-Z]+ 段从 DATA 中删除对应字符 → 剩余即标准 base64 → JSON，
 *   得到 {comic, chapter, picture:[{url,...}], ...}。
 * - 列表:  /Comic/all[/theme/{t}][/finish/{f}][/vip/{v}]/page/{p}
 * - 搜索:  /Comic/searchList?search={kw}
 */

const AC_SITE = "https://ac.qq.com";

/// 题材(theme) 表: [theme id, 显示名] 来自全站导航
const AC_THEMES = [
    ["0", "全部"],
    ["101", "玄幻"],
    ["102", "奇幻"],
    ["103", "异能"],
    ["104", "冒险"],
    ["105", "恋爱"],
    ["106", "剧情"],
    ["108", "科幻"],
    ["109", "动作"],
    ["110", "恐怖"],
    ["111", "犯罪"],
    ["112", "悬疑"],
    ["113", "日常"],
    ["114", "竞技"],
    ["115", "武侠"],
    ["116", "历史"],
    ["117", "战争"],
];

function acClean(str) {
    if (str == null) return "";
    return String(str)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

/// 从列表块取封面: 优先 data-original, 兼容单/双引号
function acPickCover(block) {
    let m = /<img[^>]*?data-original=['"]([^'"]+)['"]/.exec(block);
    if (!m) m = /<img[^>]*?\ssrc=['"]([^'"]+)['"]/.exec(block);
    if (!m) return "";
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    return u;
}

/// 从列表块取标题: 优先作品链接的 title 属性 (避免混入 签约/独家 角标)
function acPickTitle(block) {
    let m = /<a[^>]*?title="([^"]+)"[^>]*?href="[^"]*comicInfo\/id\/\d+"/i.exec(block)
        || /<a[^>]*?href="[^"]*comicInfo\/id\/\d+"[^>]*?title="([^"]+)"/i.exec(block)
        || /<img[^>]*?alt="([^"]*)"/.exec(block);
    return m ? acClean(m[1]) : "";
}

/**
 * 复刻阅读器 JS 的 DATA 解码:
 * 1) 依 nonce 的 \d+[a-zA-Z]+ 段（自后向前）从 DATA 中 splice 删除字符
 * 2) 剩余字符串按标准 base64 解码并 utf8 还原 → JSON
 */
function acDecodeData(encoded, nonce) {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    function utf8Decode(str) {
        var out = "", i = 0, c, c2, c3;
        while (i < str.length) {
            c = str.charCodeAt(i);
            if (c < 128) { out += String.fromCharCode(c); i++; }
            else if (c > 191 && c < 224) {
                c2 = str.charCodeAt(i + 1);
                out += String.fromCharCode(((c & 31) << 6) | (c2 & 63)); i += 2;
            } else {
                c2 = str.charCodeAt(i + 1); c3 = str.charCodeAt(i + 2);
                out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); i += 3;
            }
        }
        return out;
    }
    function b64Decode(str) {
        str = str.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        var out = "", i = 0, e1, e2, e3, e4, c1, c2, c3;
        while (i < str.length) {
            e1 = keyStr.indexOf(str.charAt(i++));
            e2 = keyStr.indexOf(str.charAt(i++));
            e3 = keyStr.indexOf(str.charAt(i++));
            e4 = keyStr.indexOf(str.charAt(i++));
            c1 = (e1 << 2) | (e2 >> 4);
            c2 = ((e2 & 15) << 4) | (e3 >> 2);
            c3 = ((e3 & 3) << 6) | e4;
            out += String.fromCharCode(c1);
            if (e3 !== 64) out += String.fromCharCode(c2);
            if (e4 !== 64) out += String.fromCharCode(c3);
        }
        return utf8Decode(out);
    }

    var T = encoded.split("");
    var segs = nonce.match(/\d+[a-zA-Z]+/g) || [];
    for (var i = segs.length - 1; i >= 0; i--) {
        var locate = parseInt(segs[i], 10) & 255;
        var letters = segs[i].replace(/\d+/g, "");
        if (locate < T.length) {
            T.splice(locate, letters.length);
        }
    }
    return JSON.parse(b64Decode(T.join("")));
}

/**
 * 计算阅读页 nonce 赋值表达式的值（形如 "72f"+(+eval("!!1*5")).toString()+"b1dc..."）。
 * 表达式来自本站页面，允许用引擎 eval 求值（与官方阅读器行为一致）。
 */
function acEvalNonce(expr) {
    if (!expr) return "";
    try {
        return String(eval(expr));
    } catch (e) {
        // 兜底: 表达式若只是字面量拼接
        return acClean(expr).replace(/'/g, "").replace(/"/g, "");
    }
}

class TencentComic extends ComicSource {
    // name of the source
    name = "腾讯动漫";

    // unique id of the source
    key = "ac_qq";

    version = "1.0.0";

    minAppVersion = "1.0.0";

    // update url
    url = "https://cdn.jsdelivr.net/gh/Angus-fw/venera-configs@main/ac_qq.js";

    init() {
        this._headers = {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            referer: AC_SITE + "/",
        };

        this._get = async (url) => {
            let res = await Network.get(url, this._headers);
            if (res.status !== 200) {
                throw `腾讯动漫 请求失败: ${res.status} ${url}`;
            }
            return res.body;
        };

        // 列表解析: /Comic/all 系列页 (每页 12 条 ret-search-item)
        this._parseAllList = (html) => {
            let comics = [];
            let re = /<li class="ret-search-item[^"]*">([\s\S]*?)<\/li>/g;
            let m;
            while ((m = re.exec(html)) != null) {
                let block = m[1];
                let href = /comicInfo\/id\/(\d+)/.exec(block);
                if (!href) continue;
                let h3m = /<h3[^>]*class="ret-works-title[^"]*">([\s\S]*?)<\/h3>/.exec(block);
                let title = acPickTitle(block)
                    || (h3m ? acClean(h3m[1]).replace(/(签约|独家|付费)/g, "") : "");
                let author = /<p class="ret-works-author"[^>]*>([\s\S]*?)<\/p>/.exec(block);
                let extra = /<span class="mod-cover-list-text">([\s\S]*?)<\/span>/.exec(block);
                comics.push(new Comic({
                    id: href[1],
                    title: title,
                    subTitle: acClean(author ? author[1] : (extra ? extra[1] : "")),
                    cover: acPickCover(block),
                }));
            }
            return comics;
        };

        // 搜索解析: mod_book_list 布局
        this._parseSearchList = (html) => {
            let comics = [];
            let re = /<ul class="mod_book_list[^"]*">([\s\S]*?)<\/ul>/g;
            let m;
            while ((m = re.exec(html)) != null) {
                let block = m[1];
                let itemRe = /<li>([\s\S]*?)<\/li>/g;
                let im;
                while ((im = itemRe.exec(block)) != null) {
                    let item = im[1];
                    let href = /comicInfo\/id\/(\d+)/.exec(item);
                    if (!href) continue;
                    let title = acPickTitle(item);
                    let desc = /class="[^"]*book_(?:decs|intro)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/.exec(item);
                    comics.push(new Comic({
                        id: href[1],
                        title: title,
                        subTitle: desc ? acClean(desc[1]) : "",
                        cover: acPickCover(item),
                    }));
                }
            }
            return comics;
        };

        this._parseMaxPage = (html) => {
            let pgs = [];
            let re = /\/page\/(\d+)(?=["'])/g;
            let m;
            while ((m = re.exec(html)) != null) {
                pgs.push(parseInt(m[1], 10));
            }
            if (pgs.length === 0) return 1;
            return Math.max.apply(null, pgs);
        };
    }

    // ---------- 探索(列表)页 ----------
    explore = [
        {
            title: "漫画大全",
            type: "multiPageComicList",
            load: async (page) => {
                let n = page && page > 0 ? page : 1;
                let html = await this._get(`${AC_SITE}/Comic/all/page/${n}`);
                return { comics: this._parseAllList(html), maxPage: this._parseMaxPage(html) };
            },
        },
        {
            title: "连载中",
            type: "multiPageComicList",
            load: async (page) => {
                let n = page && page > 0 ? page : 1;
                let html = await this._get(`${AC_SITE}/Comic/all/finish/1/page/${n}`);
                return { comics: this._parseAllList(html), maxPage: this._parseMaxPage(html) };
            },
        },
        {
            title: "已完结",
            type: "multiPageComicList",
            load: async (page) => {
                let n = page && page > 0 ? page : 1;
                let html = await this._get(`${AC_SITE}/Comic/all/finish/2/page/${n}`);
                return { comics: this._parseAllList(html), maxPage: this._parseMaxPage(html) };
            },
        },
        {
            title: "免费漫画",
            type: "multiPageComicList",
            load: async (page) => {
                let n = page && page > 0 ? page : 1;
                let html = await this._get(`${AC_SITE}/Comic/all/vip/1/page/${n}`);
                return { comics: this._parseAllList(html), maxPage: this._parseMaxPage(html) };
            },
        },
    ];

    // ---------- 分类(题材) ----------
    category = {
        title: "腾讯动漫",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: AC_THEMES.map(([id, label]) => ({
                    label: label,
                    target: {
                        page: "category",
                        attributes: { category: label, param: `t${id}` },
                    },
                })),
            },
        ],
        enableRankingPage: false,
    };

    categoryComics = {
        optionList: [
            {
                label: "连载状态",
                options: ["0-全部", "1-连载中", "2-已完结"],
            },
            {
                label: "付费情况",
                options: ["0-全部", "1-免费", "2-付费"],
            },
        ],
        load: async (category, param, options, page) => {
            let theme = "0";
            if (param) {
                let m = /^t(\d+)$/.exec(param);
                if (m) theme = m[1];
            }
            let status = "0";
            let pay = "0";
            if (Array.isArray(options)) {
                status = options[0] ? options[0].split("-")[0] || "0" : "0";
                pay = options[1] ? options[1].split("-")[0] || "0" : "0";
            }
            let path = "/Comic/all";
            if (theme !== "0") path += `/theme/${theme}`;
            if (status !== "0") path += `/finish/${status}`;
            if (pay !== "0") path += `/vip/${pay}`;
            let n = page && page > 0 ? page : 1;
            let html = await this._get(`${AC_SITE}${path}/page/${n}`);
            return { comics: this._parseAllList(html), maxPage: this._parseMaxPage(html) };
        },
    };

    // ---------- 搜索 ----------
    search = {
        load: async (keyword, options, page) => {
            let html = await this._get(
                `${AC_SITE}/Comic/searchList?search=${encodeURIComponent(keyword)}`
            );
            return { comics: this._parseSearchList(html), maxPage: 1 };
        },
        enableTagsSuggestions: false,
    };

    // ---------- 详情与阅读 ----------
    comic = {
        loadInfo: async (id) => {
            let html = await this._get(`${AC_SITE}/Comic/comicInfo/id/${id}`);

            let title = /<h1[^>]*class="works-intro-title[^"]*">\s*<strong>([\s\S]*?)<\/strong>/.exec(html)
                || /<h1[^>]*class="works-intro-title[^"]*">([\s\S]*?)<\/h1>/.exec(html);
            let cover = /<div class="works-cover[^>]*">[\s\S]*?<img[^>]*?\ssrc=['"]([^'"]+)/.exec(html)
                || /<img[^>]*?\ssrc=['"](https:\/\/manhua\.acimg\.cn\/vertical[^'"]+)/.exec(html);
            let status = /class="works-intro-status">([\s\S]*?)<\/label>/.exec(html);
            let author = /作者：\s*<em[^>]*>([\s\S]*?)<\/span>/.exec(html);
            let collect = /收藏数：<em[^>]*>([^<]+)<\/em>/.exec(html);
            let score = /评分：<strong[^>]*>([\d.]+)<\/strong>/.exec(html);
            let updateTime = /最新话：[\s\S]*?<span class="ui-pl10 ui-text-gray6">([\s\S]*?)<\/span>/.exec(html);
            let desc = /class="works-intro-short[^"]*">([\s\S]*?)<\/p>/.exec(html);

            // 章节: 整页扫描 cid 锚点, 去重, 按 cid 升序
            let chapterMap = new Map();
            let cidRe = /<a[^>]*href="\/ComicView\/index\/id\/\d+\/cid\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
            let m;
            while ((m = cidRe.exec(html)) != null) {
                let cid = m[1];
                let name = acClean(m[2]).replace(/^\[|\]$/g, "").trim();
                if (!name) continue;
                if (/^(开始阅读|开始追漫|立即阅读|继续阅读|手机阅读)$/.test(name)) continue;
                if (chapterMap.has(cid)) continue;
                chapterMap.set(cid, name);
            }
            if (chapterMap.size === 0) {
                throw "腾讯动漫 未找到章节";
            }
            // 升序排列
            let chapters = new Map(
                Array.from(chapterMap.entries()).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
            );

            let tags = {};
            let authorText = acClean(author ? author[1] : "");
            if (authorText) tags["作者"] = [authorText];
            let statusText = acClean(status ? status[1] : "");
            if (statusText) tags["状态"] = [statusText];
            if (collect) tags["收藏"] = [acClean(collect[1])];

            return new ComicDetails({
                title: acClean(title ? title[1] : id),
                subTitle: authorText,
                cover: cover ? (cover[1].startsWith("//") ? "https:" + cover[1] : cover[1]) : "",
                description: desc ? acClean(desc[1]) : "",
                tags: tags,
                updateTime: updateTime ? acClean(updateTime[1]) : null,
                stars: score ? Math.min(5, parseFloat(score[1]) / 2) : null,
                chapters: chapters,
            });
        },

        loadEp: async (comicId, epId) => {
            let html = await this._get(
                `${AC_SITE}/ComicView/index/id/${comicId}/cid/${epId}`
            );

            // 内联数据: var DATA = '...'  (其后通常以逗号续写其它变量)
            let dataM = /var\s+DATA\s*=\s*(['"])([\s\S]*?)\1/.exec(html);
            if (!dataM) {
                throw "腾讯动漫 无法解析章节数据";
            }
            // nonce: window["no"+"nce"]=... 或 window["n"+"once"]=...; 取最后赋值
            let nonceExprs = [];
            let nonceRe = /window\["[a-z]+"\s*\+\s*"[a-z]+"\]\s*=\s*([^;]+);/g;
            let nm;
            while ((nm = nonceRe.exec(html)) != null) {
                nonceExprs.push(nm[1]);
            }
            if (nonceExprs.length === 0) {
                throw "腾讯动漫 无法解析章节口令";
            }
            let nonce = acEvalNonce(nonceExprs[nonceExprs.length - 1]);

            let json;
            try {
                json = acDecodeData(dataM[2], nonce);
            } catch (e) {
                throw `腾讯动漫 章节数据解码失败: ${e}`;
            }

            let pic = (json && json.picture) || [];
            let images = [];
            for (let p of pic) {
                if (p && p.url) {
                    let u = p.url;
                    if (u.startsWith("//")) u = "https:" + u;
                    images.push(u);
                }
            }
            if (images.length === 0) {
                throw "腾讯动漫 本章无可用图片";
            }
            return { images: images };
        },

        // 粘贴纯数字 id 即可识别
        idMatch: "^\\d+$",

        link: {
            domains: ["ac.qq.com"],
            linkToId: (url) => {
                let m = /comicInfo\/id\/(\d+)/i.exec(url);
                if (m) return m[1];
                m = /ComicView\/index\/id\/(\d+)\/cid\//.exec(url);
                return m ? m[1] : null;
            },
        },

        enableTagsTranslate: false,
    };
}
