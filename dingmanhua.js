/** @type {import('./_venera_.js')} */
/*
 * 顶漫画 (dingmanhua.com) — Venera 漫画源
 *
 * - 列表/搜索/详情均为服务端渲染 HTML；章节图在阅读页内联 JS 中给出
 *   `pasd + i + ".webp"` 规律生成，因此 loadEp 直接解析数量与基础目录。
 * - 章节全量列表由 POST /comic/{id} (JSON) 返回。
 */

const DM_SITE = "https://www.dingmanhua.com";

/// 地区(分类) 选项: [站点 category 值, 显示名]
const DM_REGIONS = [["0","全部"],["1","日本漫画"],["3","大陆漫画"],["4","韩国漫画"],["14","港台漫画"]];

/// 题材(tag) 完整去重表: [站点 tag 值, 显示名]（供标签点击反查 id）
const DM_TAGS = [["0","全部"],["1","悬疑"],["2","欢乐"],["3","搞笑"],["4","玄幻"],["5","冒险"],["6","爱情"],["7","百合"],["8","推理"],["9","热血"],["10","异界"],["11","轻改"],["12","奇幻"],["13","校园"],["14","妹控"],["15","生活"],["16","竞技"],["17","同人"],["18","伪娘"],["19","东方"],["20","美食"],["21","格斗"],["22","战争"],["23","舰娘"],["24","治愈"],["25","魔幻"],["26","职场"],["27","性转"],["28","萌系"],["29","后宫"],["30","节操"],["31","魔法"],["32","科幻"],["33","穿越"],["34","仙侠"],["35","都市"],["36","异能"],["37","网游"],["38","短篇"],["39","女主"],["40","恐怖"],["41","重生"],["42","日常"],["43","侦探"],["44","言情"],["45","生存"],["46","武侠"],["47","系统"],["48","励志"],["49","末世"],["50","转生"],["51","长篇"],["52","修仙"],["53","末日"],["54","灵异"],["55","游戏"],["56","爱倩"],["57","销毁"],["58","病娇"],["59","音乐"],["60","爆笑"],["61","机战"],["62","复仇"],["63","舞蹈"],["64","战斗"],["65","逆袭"],["66","历史"],["67","恋爱"],["68","养成"],["69","四格"],["70","宫廷"],["71","诡异"],["72","惊悚"],["73","耽美"],["74","彩色"],["75","其他"],["76","TL"],["77","宅系"],["78","FATE"],["79","C103"],["80","C105"],["81","歡樂向"],["82","愛情"],["83","冒險"],["84","神鬼"],["85","轻小说"],["86","格鬥"],["87","後宮"],["88","C106"],["89","C107"],["91","性转换"],["92","AA"]];

/// 题材表: 反查 tag id -> 显示名
const DM_TAG_NAME = {};
DM_TAGS.forEach(([id, label]) => { DM_TAG_NAME[id] = label; });

/// 题材表: 显示名 -> tag id（首个）
const DM_TAG_ID = {};
DM_TAGS.forEach(([id, label]) => {
    if (DM_TAG_ID[label] == null) { DM_TAG_ID[label] = id; }
});

/// 展示在分类页的题材子集
const DM_TAG_CHIPS = [["0","全部"],["1","悬疑"],["2","欢乐"],["3","搞笑"],["4","玄幻"],["5","冒险"],["6","爱情"],["7","百合"],["8","推理"],["9","热血"],["10","异界"],["11","轻改"],["12","奇幻"],["13","校园"],["14","妹控"],["15","生活"],["16","竞技"],["17","同人"],["18","伪娘"],["19","东方"],["20","美食"],["21","格斗"],["22","战争"],["23","舰娘"],["24","治愈"],["25","魔幻"],["26","职场"],["27","性转"],["28","萌系"],["29","后宫"],["30","节操"],["31","魔法"],["32","科幻"],["33","穿越"],["34","仙侠"],["35","都市"],["36","异能"],["37","网游"],["38","短篇"],["39","女主"],["40","恐怖"],["41","重生"],["42","日常"],["43","侦探"],["44","言情"],["45","生存"],["46","武侠"],["47","系统"],["48","励志"],["49","末世"],["50","转生"],["51","长篇"],["52","修仙"],["53","末日"],["54","灵异"],["55","游戏"],["56","爱倩"],["57","销毁"],["58","病娇"],["59","音乐"],["60","爆笑"]];

function dmDecode(str) {
    if (str == null) { return ""; }
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

class DingManhua extends ComicSource {
    name = "顶漫画";
    key = "dingmanhua";
    version = "1.0.1";
    minAppVersion = "1.0.0";

    /// 更新地址 (jsDelivr 分发)
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/dingmanhua.js";

    init() {
        this._tagId = DM_TAG_ID;

        /// GET 返回 utf-8 字符串，非 200 抛错
        this._get = async (url) => {
            let res = await Network.get(url);
            if (res.status !== 200) {
                throw `顶漫画 请求失败: ${res.status} ${url}`;
            }
            return res.body;
        };

        /// POST /comic/{id} 获取全量章节列表
        this._postChapters = async (id) => {
            let res = await Network.sendRequest(
                "POST",
                `${DM_SITE}/comic/${id}`,
                {
                    "content-type": "application/json",
                    "x-requested-with": "XMLHttpRequest",
                },
                "{}"
            );
            if (res.status !== 200) {
                throw `顶漫画 章节请求失败: ${res.status}`;
            }
            let json = JSON.parse(res.body);
            if (json.code !== 0 || !json.data || !json.data.chapters) {
                throw "顶漫画 章节数据格式异常";
            }
            return json.data.chapters; // [{id, chapterName, ...}]
        };

        /// 通用 manga-card 网格解析 (sort / search / home 的卡片同构)
        this._parseGrid = (html) => {
            let comics = [];
            let re = /<(?:article|div)\s+class="manga-card"[^>]*>([\s\S]*?)<\/a>\s*<\/(?:article|div)>/g;
            let m;
            while ((m = re.exec(html)) != null) {
                let block = m[1];
                let href = /href="\/comic\/(\d+)\.html"/.exec(block);
                if (!href) { continue; }
                let img = /<img[^>]*?(?:data-src)="([^"]+)"/.exec(block)
                    || /<img[^>]*?\ssrc="([^"]+)"/.exec(block);
                let title = /<div class="manga-title">([\s\S]*?)<\/div>/.exec(block)
                    || /<img[^>]*?alt="([^"]*)"/.exec(block);
                comics.push(new Comic({
                    id: href[1],
                    title: dmDecode(title ? title[1] : ""),
                    cover: img ? img[1] : "",
                }));
            }
            return comics;
        };

        /// /new 的 update-item 行解析
        this._parseUpdates = (html) => {
            let comics = [];
            let re = /<a class="update-item"[^>]*href="\/comic\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
            let m;
            while ((m = re.exec(html)) != null) {
                let block = m[2];
                let img = /<img[^>]*?(?:data-src)="([^"]+)"/.exec(block)
                    || /<img[^>]*?\ssrc="([^"]+)"/.exec(block);
                let title = /<strong>([\s\S]*?)<\/strong>/.exec(block);
                let author = /<div class="update-copy">[\s\S]*?<strong>[\s\S]*?<\/strong>\s*<span>([\s\S]*?)<\/span>/.exec(block);
                comics.push(new Comic({
                    id: m[1],
                    title: dmDecode(title ? title[1] : ""),
                    subTitle: dmDecode(author ? author[1] : ""),
                    cover: img ? img[1] : "",
                }));
            }
            return comics;
        };

        /// 解析分页 "1 / 479" 或 "1 of 15"，返回总页数
        this._parseMaxPage = (html) => {
            let m = /\bpagination-info\b[^>]*>\s*\d+\s*\/\s*(\d+)/.exec(html)
                || /id="pageInfo"[^>]*>\s*\d+\s+of\s+(\d+)/.exec(html);
            let total = m ? parseInt(m[1]) : 1;
            return total > 0 ? total : 1;
        };
    }

    // ---------- 首页 / 探索 ----------
    explore = [
        {
            title: "顶漫画",
            type: "singlePageWithMultiPart",
            load: async () => {
                let html = await this._get(DM_SITE);
                let result = {};
                // 首页分区 (含 manga-grid 或 update-item 的 .section)
                let re = /<section class="section"[^>]*>([\s\S]*?)<\/section>/g;
                let m;
                while ((m = re.exec(html)) != null) {
                    let block = m[1];
                    let comics = [];
                    let key = "";
                    let h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block);
                    if (h2) { key = dmDecode(h2[1]); }
                    if (block.indexOf("manga-grid") >= 0) {
                        comics = this._parseGrid(block);
                    } else if (block.indexOf("update-item") >= 0) {
                        comics = this._parseUpdates(block);
                    }
                    if (key && comics.length > 0) {
                        result[key] = comics;
                    }
                }
                // 兜底：没有任何分区时给个首页网格
                if (Object.keys(result).length === 0) {
                    let key2 = "热门";
                    result[key2] = this._parseGrid(html);
                }
                return result;
            },
        },
        {
            title: "最近更新",
            type: "multiPageComicList",
            load: async (page) => {
                let n = (page && page > 0) ? page : 1;
                let html = await this._get(`${DM_SITE}/new?page=${n}`);
                return {
                    comics: this._parseUpdates(html),
                    maxPage: this._parseMaxPage(html),
                };
            },
        },
    ];

    // ---------- 分类 ----------
    category = {
        title: "顶漫画",
        parts: [
            {
                name: "地区",
                type: "fixed",
                categories: DM_REGIONS.map(([id, label]) => ({
                    label: label,
                    target: {
                        page: "category",
                        attributes: { category: label, param: `r${id}` },
                    },
                })),
            },
            {
                name: "题材",
                type: "fixed",
                categories: DM_TAG_CHIPS.map(([id, label]) => ({
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
        load: async (category, param, options, page) => {
            let region = "0";
            let tag = "0";
            if (param) {
                let rm = /^r(\d+)$/.exec(param);
                let tm = /^t(\d+)$/.exec(param);
                if (rm) { region = rm[1]; }
                if (tm) { tag = tm[1]; }
            }
            let n = (page && page > 0) ? page : 1;
            let html = await this._get(
                `${DM_SITE}/sort?category=${region}&tag=${tag}&page=${n}`
            );
            return {
                comics: this._parseGrid(html),
                maxPage: this._parseMaxPage(html),
            };
        },
    };

    // ---------- 搜索 ----------
    search = {
        load: async (keyword, options, page) => {
            let n = (page && page > 0) ? page : 1;
            let html = await this._get(
                `${DM_SITE}/search?query=${encodeURIComponent(keyword)}&page=${n}`
            );
            return {
                comics: this._parseGrid(html),
                maxPage: this._parseMaxPage(html),
            };
        },
        enableTagsSuggestions: false,
    };

    // ---------- 详情与阅读 ----------
    comic = {
        loadInfo: async (id) => {
            let html = await this._get(`${DM_SITE}/comic/${id}.html`);
            let title = /<h1[^>]*class="manga-title"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
            let cover = /<img[^>]*id="mangaCover"[^>]*\ssrc="([^"]+)"/.exec(html)
                || /<img[^>]*\ssrc="([^"]+)"[^>]*id="mangaCover"/.exec(html);
            let author = /id="mangaAuthor"[^>]*>([\s\S]*?)<\/span>/.exec(html);
            let status = /状态:<\/span>\s*<span>([\s\S]*?)<\/span>/.exec(html);
            let updated = /更新时间:<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(html);
            let latest = /最新话:<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(html);

            // 标签 (href 内含 tag id)
            let tagLabels = [];
            let tagsBlock = /<div class="manga-tags"[^>]*>([\s\S]*?)<\/div>/.exec(html);
            if (tagsBlock) {
                let tre = /\/sort\?tag=(\d+)"[^>]*>[\s\S]*?<span class="tag">([\s\S]*?)<\/span>/g;
                let tm;
                while ((tm = tre.exec(tagsBlock[1])) != null) {
                    tagLabels.push(dmDecode(tm[2]));
                }
            }

            // 简介
            let desc = "";
            let dp = /<p[^>]*id="mangaDescription"[^>]*>([\s\S]*?)<\/p>/.exec(html);
            if (dp) {
                desc = dmDecode(dp[1]);
            } else {
                let dm = /<meta name="description" content=(?:"([^"]*)"|'([^']*)')/.exec(html);
                if (dm) {
                    let raw = dm[1] || dm[2];
                    let i = raw.indexOf("作品简介：");
                    desc = dmDecode(i >= 0 ? raw.slice(i + 5) : raw);
                }
            }

            // 章节
            let chapters = new Map();
            try {
                let list = await this._postChapters(id);
                for (let c of list) {
                    if (c.id != null && c.chapterName) {
                        chapters.set(String(c.id), c.chapterName);
                    }
                }
            } catch (e) {
                // 兜底: 从页面内嵌章节列表提取
                let cre = /href="\/chapter\/\d+-(\d+)\.html"[\s\S]*?<div class="chapter-title">([\s\S]*?)<\/div>/g;
                let cm;
                while ((cm = cre.exec(html)) != null) {
                    chapters.set(cm[1], dmDecode(cm[2]));
                }
            }
            if (chapters.size === 0) {
                throw "顶漫画 未找到章节";
            }
            // 接口返回最新在前, 这里按章节 id 升序排列, 保证从第 1 章开始阅读
            chapters = new Map(
                Array.from(chapters.entries())
                    .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
            );

            return new ComicDetails({
                title: dmDecode(title ? title[1] : id),
                subTitle: dmDecode(author ? author[1] : ""),
                cover: cover ? cover[1] : "",
                description: desc,
                tags: {
                    类型: tagLabels,
                    状态: status ? [dmDecode(status[1])] : [],
                    最新: latest ? [dmDecode(latest[1].replace(/<[^>]*>/g, " "))] : [],
                },
                updateTime: updated ? dmDecode(updated[1]) : null,
                chapters: chapters,
            });
        },

        loadEp: async (comicId, epId) => {
            let html = await this._get(`${DM_SITE}/chapter/${comicId}-${epId}.html`);
            // 阅读页内联脚本: var num = eval("N") / var pasd = "..."
            let numM = /var\s+num\s*=\s*(?:eval\(")?(\d+)/.exec(html);
            let pasdM = /var\s+pasd\s*=\s*["']([^"']+)["']/.exec(html);
            if (!numM || !pasdM) {
                throw "顶漫画 无法解析章节图片列表";
            }
            let num = parseInt(numM[1]);
            let base = pasdM[1];
            if (!(num > 0) || !base) {
                throw "顶漫画 章节图片数据异常";
            }
            let images = [];
            for (let i = 1; i <= num; i++) {
                images.push(`${base}${i}.webp`);
            }
            return { images: images };
        },

        // 粘贴纯数字 id / 链接时识别
        idMatch: "^\\d+$",

        link: {
            domains: ["dingmanhua.com"],
            linkToId: (url) => {
                let m = /\/comic\/(\d+)\.html/.exec(url);
                return m ? m[1] : null;
            },
        },

        onClickTag: (namespace, tag) => {
            if (namespace !== "类型") {
                throw `不支持的标签: ${namespace}`;
            }
            let id = this._tagId[tag];
            if (id == null) { id = 0; }
            return {
                page: "category",
                attributes: { category: tag, param: `t${id}` },
            };
        },

        enableTagsTranslate: false,
    };
}
