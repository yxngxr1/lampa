(function () {
    'use strict';

    if (window.rutor_top_plugin) return;
    window.rutor_top_plugin = true;

    var SOURCE = 'rutor_top';
    var MINIMAL_TOP_COMPONENT = 'rutor_top_minimal';
    var MINIMAL_LIST_COMPONENT = 'rutor_list_minimal';
    var BASE = 'http://rutor.info';
    var CACHE_KEY = 'rutor_top_tmdb_cache';
    var CACHE_LIFE = 1000 * 60 * 60 * 24 * 7;

    // ID категорий + сортировка по сидам
    var CAT_MAP = {
        'Зарубежные фильмы':        BASE + '/browse/0/1/0/2',
        'Наши фильмы':              BASE + '/browse/0/5/0/2',
        'Зарубежные сериалы':       BASE + '/browse/0/4/0/2',
        'Наши сериалы':             BASE + '/browse/0/16/0/2',
        'Научно-популярные фильмы': BASE + '/browse/0/12/0/2',
        'Телевизор':                BASE + '/browse/0/6/0/2',
        'Мультипликация':           BASE + '/browse/0/7/0/2',
        'Аниме':                    BASE + '/browse/0/10/0/2'
    };

    var NEEDED = Object.keys(CAT_MAP);

    var network = new Lampa.Reguest();
    var cache = Lampa.Storage.get(CACHE_KEY, {});

    // ============================================================
    // Settings
    // ============================================================

    function getProxy() {
        return Lampa.Storage.get(
            'rutor_proxy',
            'https://cors-proxy.gderganov.workers.dev/?url='
        ) || '';
    }

    // Лимит торрентoв в каждой строке/категории топа
    function getTopLimit() {
        var v = parseInt(Lampa.Storage.get('rutor_limit', '10'), 10);

        if (isNaN(v) || v < 5) v = 5;
        if (v > 15) v = 15;

        return v;
    }

    // Лимит при открытии конкретной категории
    function getListLimit() {
        var v = parseInt(Lampa.Storage.get('rutor_list_limit', '40'), 10);

        if (isNaN(v) || v < 20) v = 20;
        if (v > 100) v = 100;

        return v;
    }

    function getViewMode() {
        return Lampa.Storage.get('rutor_view', 'cards') || 'cards';
    }

    function getCacheEnabled() {
        var v = Lampa.Storage.get('rutor_cache', true);
        return v === true || v === 'true';
    }

    function getLogLevel() {
        return Lampa.Storage.get('rutor_log', 'info') || 'info';
    }

    // ============================================================
    // Logger
    // ============================================================

    var log = {
        _ok: function (lvl) {
            var order = {
                off: 0,
                error: 1,
                info: 2,
                debug: 3
            };

            var cur = order[getLogLevel()] || 0;

            return cur >= (order[lvl] || 0);
        },

        info: function () {
            if (this._ok('info')) {
                console.log.apply(
                    console,
                    ['[Rutor]'].concat(Array.prototype.slice.call(arguments))
                );
            }
        },

        debug: function () {
            if (this._ok('debug')) {
                console.log.apply(
                    console,
                    ['[Rutor:debug]'].concat(Array.prototype.slice.call(arguments))
                );
            }
        },

        error: function () {
            if (this._ok('error')) {
                console.error.apply(
                    console,
                    ['[Rutor:error]'].concat(Array.prototype.slice.call(arguments))
                );
            }
        },

        group: function (title, obj) {
            if (!this._ok('info')) return;

            console.groupCollapsed('[Rutor] ' + title);

            if (obj !== undefined) {
                console.log(obj);
            }

            console.groupEnd();
        }
    };

    function saveCache() {
        if (getCacheEnabled()) {
            Lampa.Storage.set(CACHE_KEY, cache);
        }
    }

    // ============================================================
    // Title / year
    // ============================================================

    function cleanTitle(name) {
        name = String(name || '');

        var yearMatch = name.match(
            /\((\d{4})(?:\s*[-–]\s*\d{4})?\)/
        );

        var titlePart = yearMatch
            ? name.slice(0, yearMatch.index)
            : name;

        titlePart = titlePart.replace(/\[.*?\]/g, '');
        titlePart = titlePart.split('/')[0];
        titlePart = titlePart.replace(/\s+/g, ' ').trim();

        if (!titlePart) {
            titlePart = name
                .split(/[\(\[]/)[0]
                .split('/')[0]
                .trim();
        }

        return titlePart;
    }

    function getYear(name) {
        var m = String(name || '').match(
            /\((\d{4})(?:\s*[-–]\s*\d{4})?\)/
        );

        return m ? m[1] : '';
    }

    // ============================================================
    // Network
    // ============================================================

    function fetchHtml(url, success, error) {
        var proxyBase = getProxy();
        var finalUrl = proxyBase
            ? (proxyBase + encodeURIComponent(url))
            : url;

        log.debug('fetch', finalUrl);

        network.silent(
            finalUrl,

            function (html) {
                if (typeof html === 'string' && html.length > 300) {
                    success(html);
                } else {
                    log.error('empty response', url);

                    if (error) {
                        error('empty');
                    }
                }
            },

            function (err) {
                log.error('request failed', url, err);

                if (error) {
                    error(err);
                }
            },

            false,

            {
                dataType: 'text',
                timeout: 15000
            }
        );
    }

    // ============================================================
    // TMDB
    // ============================================================

    function searchTMDB(torrentName, callback) {
        var key = String(torrentName || '')
            .toLowerCase()
            .slice(0, 120);

        var now = Date.now();

        if (
            getCacheEnabled() &&
            cache[key] &&
            (now - cache[key].ts) < CACHE_LIFE
        ) {
            log.debug(
                'cache hit',
                cleanTitle(torrentName)
            );

            return callback(cache[key].card || null);
        }

        var title = cleanTitle(torrentName);
        var year = getYear(torrentName);
        var lang = Lampa.Storage.get('tmdb_lang', 'ru') || 'ru';

        var isSeries = /\[[^\]]*\d[^\]]*\]/.test(torrentName);

        var endpoint = isSeries
            ? 'search/tv'
            : 'search/movie';

        var yearParam = isSeries
            ? 'first_air_date_year'
            : 'year';

        if (!title) {
            cache[key] = {
                ts: now,
                card: null
            };

            saveCache();

            return callback(null);
        }

        var q = encodeURIComponent(title);

        var apiUrl = Lampa.TMDB.api(
            endpoint +
            '?query=' + q +
            (year
                ? '&' + yearParam + '=' + year
                : '') +
            '&language=' + lang +
            '&api_key=' + Lampa.TMDB.key()
        );

        network.silent(
            apiUrl,

            function (json) {
                var card = null;

                if (
                    json &&
                    json.results &&
                    json.results.length
                ) {
                    card = json.results[0];

                    if (card) {
                        card.source = SOURCE;
                        card.media_type = isSeries
                            ? 'tv'
                            : 'movie';

                        if (isSeries) {
                            card.name =
                                card.name ||
                                card.title;

                            card.first_air_date =
                                card.first_air_date ||
                                card.release_date;
                        } else {
                            card.title =
                                card.title ||
                                card.name;

                            card.release_date =
                                card.release_date ||
                                card.first_air_date;
                        }
                    }
                }

                cache[key] = {
                    ts: now,
                    card: card
                };

                var keys = Object.keys(cache);

                if (keys.length > 700) {
                    keys.sort(function (a, b) {
                        return cache[a].ts - cache[b].ts;
                    });

                    keys
                        .slice(0, keys.length - 500)
                        .forEach(function (k) {
                            delete cache[k];
                        });
                }

                saveCache();

                callback(card);
            },

            function () {
                cache[key] = {
                    ts: now,
                    card: null
                };

                saveCache();

                callback(null);
            }
        );
    }

    // ============================================================
    // Rutor parser
    // ============================================================

    function parseTorrents(html, limit) {
        limit = limit || getTopLimit();

        var list = [];
        var rowRegex =
            /<tr class="(?:gai|tum)">([\s\S]*?)<\/tr>/g;

        var m;
        var i = 0;

        while (
            (m = rowRegex.exec(html)) !== null &&
            i < limit
        ) {
            var row = m[1];

            var titleM = row.match(
                /<a href="(\/torrent\/[^"]+)">([^<]+)<\/a>/
            );

            if (!titleM) {
                continue;
            }

            var commentsM = row.match(
                /alt=["']C["'][^>]*>[^0-9]*([0-9]+)/i
            );

            if (!commentsM) {
                commentsM = row.match(
                    /alt=["']C["'][^>]*\/>\s*(\d+)/i
                );
            }

            if (!commentsM) {
                commentsM = row.match(
                    /<\/a>\s*(\d+)\s*<\/td>/i
                );
            }

            var seedsM = row.match(
                /arrowup\.gif[^>]*>[^0-9]*([0-9]+)/i
            );

            var leechesM = row.match(
                /arrowdown\.gif[^>]*>[^0-9]*([0-9]+)/i
            );

            list.push({
                title: titleM[2].trim(),

                url: BASE + titleM[1],

                comments: commentsM
                    ? commentsM[1]
                    : '0',

                seeds: seedsM
                    ? seedsM[1]
                    : '0',

                leeches: leechesM
                    ? leechesM[1]
                    : '0'
            });

            i++;
        }

        return list;
    }

    function parseCategories(html) {
        var cats = [];

        var catRegex =
            /в категории <a href="?([^">]+)"?>([^<]+)<\/a><\/h2>([\s\S]*?)(?=<h2>|$)/g;

        var m;

        while ((m = catRegex.exec(html)) !== null) {
            var name = m[2];

            if (NEEDED.indexOf(name) === -1) {
                continue;
            }

            var href =
                CAT_MAP[name] ||
                (
                    m[1].indexOf('http') === 0
                        ? m[1]
                        : BASE + m[1]
                );

            cats.push({
                title: name,
                url: href,
                torrents: parseTorrents(
                    m[3],
                    getTopLimit()
                )
            });
        }

        return cats;
    }

    function resolveCards(torrents, done) {
        var results = [];
        var left = torrents.length;

        if (!left) {
            return done([]);
        }

        torrents.forEach(function (t, idx) {
            searchTMDB(t.title, function (card) {
                if (card) {
                    card.rutor = t;
                    results[idx] = card;
                }

                left--;

                if (left <= 0) {
                    done(
                        results.filter(Boolean)
                    );
                }
            });
        });
    }

    // ============================================================
    // Torrent opening
    // ============================================================

    function extractMagnet(html) {
        if (typeof html !== 'string') {
            return '';
        }

        var patterns = [
            /href=["'](magnet:\?[^"']+)["']/i,
            /(magnet:\?xt=urn:btih:[^\s"'<>]+)/i
        ];

        for (var i = 0; i < patterns.length; i++) {
            var m = html.match(patterns[i]);

            if (m && m[1]) {
                return m[1]
                    .replace(/&amp;/g, '&')
                    .replace(/&#38;/g, '&');
            }
        }

        return '';
    }

    function startTorrent(t, movie) {
        if (!t || !t.title) {
            return;
        }

        var element = {
            title: t.title,
            Title: t.title,

            Link: t.magnet || t.url,

            MagnetUri: t.magnet || '',

            magnet: t.magnet || '',

            url: t.url,

            source: SOURCE
        };

        var fallbackMovie = movie || {
            title: t.title,
            original_title: t.title,
            name: t.title,
            original_name: t.title
        };

        // Основной штатный путь
        if (
            Lampa.Torrent &&
            typeof Lampa.Torrent.start === 'function'
        ) {
            Lampa.Torrent.start(
                element,
                fallbackMovie
            );

            return;
        }

        // Альтернативный TorrServer API
        if (
            window.TorrServer &&
            typeof window.TorrServer.open === 'function' &&
            t.magnet
        ) {
            window.TorrServer.open(
                t.magnet
            );

            return;
        }

        // Старый вариант API
        if (
            Lampa.Torrent &&
            typeof Lampa.Torrent.open === 'function' &&
            t.hash
        ) {
            Lampa.Torrent.open(
                t.hash,
                fallbackMovie
            );

            return;
        }

        Lampa.Noty.show(
            'Не найден штатный обработчик торрентов Lampa'
        );
    }

    function openTorrent(t) {
        if (!t) {
            return;
        }

        // Если magnet уже есть — сразу запускаем
        if (t.magnet) {
            searchTMDB(
                t.title,
                function (card) {
                    startTorrent(
                        t,
                        card || null
                    );
                }
            );

            return;
        }

        if (
            Lampa.Loading &&
            Lampa.Loading.start
        ) {
            Lampa.Loading.start({
                title: 'Получение magnet-ссылки...'
            });
        }

        fetchHtml(
            t.url,

            function (html) {
                var magnet =
                    extractMagnet(html);

                if (
                    Lampa.Loading &&
                    Lampa.Loading.stop
                ) {
                    Lampa.Loading.stop();
                }

                if (!magnet) {
                    Lampa.Noty.show(
                        'Не удалось найти magnet-ссылку для раздачи'
                    );

                    return;
                }

                t.magnet = magnet;

                searchTMDB(
                    t.title,
                    function (card) {
                        startTorrent(
                            t,
                            card || null
                        );
                    }
                );
            },

            function () {
                if (
                    Lampa.Loading &&
                    Lampa.Loading.stop
                ) {
                    Lampa.Loading.stop();
                }

                Lampa.Noty.show(
                    'Не удалось открыть страницу раздачи Rutor'
                );
            }
        );
    }

    // ============================================================
    // Minimal UI styles
    // ============================================================

    function injectMinimalStyles() {
        if ($('#rutor-top-minimal-style').length) {
            return;
        }

        var css = '' +

            '.rutor-minimal{' +
                'width:100%;' +
                'height:100%;' +
            '}' +

            '.rutor-minimal__content{' +
                'padding:0 2.5em 3em 2.5em;' +
            '}' +

            '.rutor-minimal__table{' +
                'width:100%;' +
            '}' +

            '.rutor-minimal__head{' +
                'display:flex;' +
                'align-items:center;' +
                'min-height:3.2em;' +
                'padding:0 1em;' +
                'box-sizing:border-box;' +
                'opacity:.55;' +
                'font-size:.9em;' +
                'text-transform:uppercase;' +
            '}' +

            '.rutor-minimal__head-title{' +
                'flex:1;' +
                'min-width:0;' +
                'padding-right:1em;' +
            '}' +

            '.rutor-minimal__head-stat{' +
                'width:7.5em;' +
                'flex:0 0 7.5em;' +
                'text-align:center;' +
            '}' +

            '.rutor-minimal__category{' +
                'margin:1.2em 0 .3em 0;' +
                'padding:.85em 1em;' +
                'font-size:1.15em;' +
                'font-weight:500;' +
                'border-radius:.25em;' +
            '}' +

            '.rutor-minimal__category-arrow{' +
                'float:right;' +
                'opacity:.6;' +
            '}' +

            '.rutor-minimal__row{' +
                'display:flex;' +
                'align-items:center;' +
                'width:100%;' +
                'box-sizing:border-box;' +
                'padding:.72em 1em;' +
                'border-bottom:1px solid rgba(255,255,255,.075);' +
                'border-radius:.18em;' +
            '}' +

            '.rutor-minimal__row.focus{' +
                'background:rgba(255,255,255,.10);' +
            '}' +

            '.rutor-minimal__title{' +
                'flex:1;' +
                'min-width:0;' +
                'padding-right:1em;' +
                'line-height:1.28;' +
                'word-break:break-word;' +
            '}' +

            '.rutor-minimal__meta{' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:flex-end;' +
                'gap:.85em;' +
                'width:16em;' +
                'flex:0 0 16em;' +
                'font-size:.94em;' +
                'white-space:nowrap;' +
            '}' +

            '.rutor-minimal__comments{' +
                'opacity:.72;' +
                'min-width:3.5em;' +
                'text-align:right;' +
            '}' +

            '.rutor-minimal__seed{' +
                'color:#50c878;' +
                'min-width:4.5em;' +
                'text-align:right;' +
            '}' +

            '.rutor-minimal__leech{' +
                'color:#ef5350;' +
                'min-width:4.5em;' +
                'text-align:right;' +
            '}' +

            '.rutor-minimal__empty{' +
                'padding:2em 1em;' +
                'opacity:.55;' +
                'text-align:center;' +
            '}' +

            '.rutor-minimal__loading{' +
                'padding:3em 1em;' +
                'text-align:center;' +
                'opacity:.65;' +
            '}' +

            '@media (max-width:900px){' +

                '.rutor-minimal__content{' +
                    'padding-left:1em;' +
                    'padding-right:1em;' +
                '}' +

                '.rutor-minimal__meta{' +
                    'width:13em;' +
                    'flex-basis:13em;' +
                    'gap:.55em;' +
                '}' +

            '}' +

            '@media (max-width:700px){' +

                '.rutor-minimal__meta{' +
                    'width:11em;' +
                    'flex-basis:11em;' +
                    'font-size:.85em;' +
                    'gap:.35em;' +
                '}' +

                '.rutor-minimal__comments{' +
                    'min-width:2.5em;' +
                '}' +

                '.rutor-minimal__seed,' +
                '.rutor-minimal__leech{' +
                    'min-width:3.5em;' +
                '}' +

            '}';

        $('head').append(
            '<style id="rutor-top-minimal-style">' +
            css +
            '</style>'
        );
    }

    function makeStats(t) {
        var meta = $(
            '<div class="rutor-minimal__meta">'
        );

        meta.append(
            $('<span class="rutor-minimal__comments">')
                .text(
                    'C ' +
                    (t.comments || '0')
                )
        );

        meta.append(
            $('<span class="rutor-minimal__seed">')
                .text(
                    '↑ ' +
                    (t.seeds || '0')
                )
        );

        meta.append(
            $('<span class="rutor-minimal__leech">')
                .text(
                    '↓ ' +
                    (t.leeches || '0')
                )
        );

        return meta;
    }

    function makeTorrentRow(t, click) {
        var row = $(
            '<div class="rutor-minimal__row selector">'
        );

        row.append(
            $('<div class="rutor-minimal__title">')
                .text(t.title || '')
        );

        row.append(
            makeStats(t)
        );

        row.on(
            'hover:enter',
            function () {
                if (click) {
                    click(t);
                }
            }
        );

        return row;
    }

    function makeCategoryRow(title, url) {
        var row = $(
            '<div class="rutor-minimal__category selector">'
        );

        row.append(
            $('<span>').text(title)
        );

        row.append(
            $('<span class="rutor-minimal__category-arrow">')
                .text('›')
        );

        row.on(
            'hover:enter',
            function () {
                openMinimalList(
                    url,
                    title
                );
            }
        );

        return row;
    }

    // ============================================================
    // Controller
    // ============================================================

    function setMinimalController(
        scroll,
        focusRender,
        backHandler
    ) {
        Lampa.Controller.add(
            'content',
            {
                toggle: function () {
                    Lampa.Controller.collectionSet(
                        scroll.render(),
                        focusRender
                    );

                    Lampa.Controller.collectionFocus(
                        false,
                        focusRender
                    );
                },

                up: function () {
                    if (Navigator.canmove('up')) {
                        Navigator.move('up');
                    } else {
                        Lampa.Controller.toggle(
                            'head'
                        );
                    }
                },

                down: function () {
                    Navigator.move('down');
                },

                left: function () {
                    Lampa.Controller.toggle(
                        'menu'
                    );
                },

                right: function () {
                    Navigator.move('right');
                },

                back: backHandler
            }
        );

        Lampa.Controller.toggle('content');
    }

    // ============================================================
    // Minimal top component
    // ============================================================

    function MinimalTopComponent(object) {
        injectMinimalStyles();

        var self = this;

        var scroll = new Lampa.Scroll({
            mask: true,
            over: true
        });

        var root = $(
            '<div class="rutor-minimal">'
        );

        var content = $(
            '<div class="rutor-minimal__content">'
        );

        var table = $(
            '<div class="rutor-minimal__table">'
        );

        this.create = function () {
            var categories =
                object.categories || [];

            var head = $(
                '<div class="rutor-minimal__head">'
            );

            head.append(
                $('<div class="rutor-minimal__head-title">')
                    .text('Название')
            );

            head.append(
                $('<div class="rutor-minimal__head-stat">')
                    .text('Комментарии')
            );

            head.append(
                $('<div class="rutor-minimal__head-stat">')
                    .text('Пиры')
            );

            table.append(head);

            categories.forEach(
                function (cat) {
                    var category =
                        makeCategoryRow(
                            cat.title,
                            cat.url
                        );

                    table.append(category);

                    (cat.torrents || [])
                        .forEach(function (t) {
                            var row =
                                makeTorrentRow(
                                    t,
                                    function (torrent) {
                                        openTorrent(
                                            torrent
                                        );
                                    }
                                );

                            table.append(row);
                        });
                }
            );

            if (!categories.length) {
                table.append(
                    $(
                        '<div class="rutor-minimal__empty">'
                    ).text(
                        'Категории Rutor не найдены'
                    )
                );
            }

            content.append(table);

            scroll.append(content);

            root.append(
                scroll.render()
            );

            return root;
        };

        this.render = function () {
            return root;
        };

        this.start = function () {
            if (
                Lampa.Activity.active().activity !==
                this.activity
            ) {
                return;
            }

            setMinimalController(
                scroll,
                table,
                this.back
            );
        };

        this.pause = function () {};

        this.stop = function () {};

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.destroy = function () {
            scroll.destroy();
            root.remove();
        };
    }

    // ============================================================
    // Minimal category list component
    // ============================================================

    function MinimalListComponent(object) {
        injectMinimalStyles();

        var self = this;

        var scroll = new Lampa.Scroll({
            mask: true,
            over: true
        });

        var root = $(
            '<div class="rutor-minimal">'
        );

        var content = $(
            '<div class="rutor-minimal__content">'
        );

        var table = $(
            '<div class="rutor-minimal__table">'
        );

        var url =
            object.url ||
            BASE + '/top';

        var title =
            object.title ||
            'Rutor';

        this.create = function () {
            var head = $(
                '<div class="rutor-minimal__head">'
            );

            head.append(
                $('<div class="rutor-minimal__head-title">')
                    .text(title)
            );

            head.append(
                $('<div class="rutor-minimal__head-stat">')
                    .text('Комментарии')
            );

            head.append(
                $('<div class="rutor-minimal__head-stat">')
                    .text('Пиры')
            );

            table.append(head);

            content.append(table);

            scroll.append(content);

            root.append(
                scroll.render()
            );

            load();

            return root;
        };

        this.render = function () {
            return root;
        };

        function load() {
            table.append(
                $(
                    '<div class="rutor-minimal__loading" data-rutor-loading="1">'
                ).text(
                    'Загрузка списка...'
                )
            );

            fetchHtml(
                url,

                function (html) {
                    table
                        .find(
                            '[data-rutor-loading="1"]'
                        )
                        .remove();

                    var torrents =
                        parseTorrents(
                            html,
                            getListLimit()
                        );

                    log.group(
                        'Минималистичный список',
                        {
                            url: url,
                            title: title,
                            count: torrents.length
                        }
                    );

                    if (!torrents.length) {
                        table.append(
                            $(
                                '<div class="rutor-minimal__empty">'
                            ).text(
                                'Раздачи не найдены'
                            )
                        );

                        self.start();

                        return;
                    }

                    torrents.forEach(
                        function (t) {
                            table.append(
                                makeTorrentRow(
                                    t,
                                    function (torrent) {
                                        openTorrent(
                                            torrent
                                        );
                                    }
                                )
                            );
                        }
                    );

                    self.start();
                },

                function () {
                    table
                        .find(
                            '[data-rutor-loading="1"]'
                        )
                        .remove();

                    table.append(
                        $(
                            '<div class="rutor-minimal__empty">'
                        ).text(
                            'Не удалось загрузить список Rutor'
                        )
                    );

                    self.start();
                }
            );
        }

        this.start = function () {
            if (
                Lampa.Activity.active().activity !==
                this.activity
            ) {
                return;
            }

            setMinimalController(
                scroll,
                table,
                this.back
            );
        };

        this.pause = function () {};

        this.stop = function () {};

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.destroy = function () {
            network.clear();
            scroll.destroy();
            root.remove();
        };
    }

    // ============================================================
    // Open minimal screens
    // ============================================================

    function openMinimalTop(cats) {
        Lampa.Activity.push({
            url: '',
            title: 'Rutor Топ',

            component:
                MINIMAL_TOP_COMPONENT,

            categories: cats,

            page: 1
        });
    }

    function loadMinimalTop() {
        fetchHtml(
            BASE + '/top',

            function (html) {
                var cats =
                    parseCategories(html);

                log.group(
                    'Категории минималистичного топа',
                    cats.map(function (c) {
                        return {
                            title: c.title,
                            count: c.torrents.length,
                            url: c.url
                        };
                    })
                );

                openMinimalTop(cats);
            },

            function () {
                Lampa.Noty.show(
                    'Не удалось загрузить Rutor Топ'
                );
            }
        );
    }

    function openMinimalList(url, title) {
        Lampa.Activity.push({
            url: url,

            title:
                title ||
                'Rutor',

            component:
                MINIMAL_LIST_COMPONENT,

            page: 1
        });
    }

    // ============================================================
    // API Source — штатный карточный режим
    // ============================================================

    var Api = {

        network: network,

        category: function (
            params,
            onSuccess,
            onError
        ) {
            var partsData = [];

            fetchHtml(
                BASE + '/top',

                function (html) {
                    var cats =
                        parseCategories(html);

                    log.group(
                        'Категории топа (' +
                        cats.length +
                        ')',
                        cats.map(function (c) {
                            return {
                                title: c.title,
                                count: c.torrents.length,
                                url: c.url
                            };
                        })
                    );

                    cats.forEach(
                        function (cat) {
                            partsData.push(
                                function (call) {
                                    resolveCards(
                                        cat.torrents,
                                        function (cards) {
                                            log.info(
                                                'ряд готов:',
                                                cat.title,
                                                '→',
                                                cards.length,
                                                'карточек'
                                            );

                                            call({
                                                title:
                                                    cat.title,

                                                results:
                                                    cards,

                                                page: 1,

                                                total_pages: 2,

                                                more: true,

                                                url:
                                                    cat.url,

                                                source:
                                                    SOURCE
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );

                    function loadPart(
                        partLoaded,
                        partEmpty
                    ) {
                        Lampa.Api.partNext(
                            partsData,
                            4,
                            partLoaded,
                            partEmpty || onError
                        );
                    }

                    loadPart(
                        onSuccess,
                        onError
                    );

                    Api._next = loadPart;
                },

                onError
            );

            return function (
                resolve,
                reject
            ) {
                if (Api._next) {
                    Api._next(
                        resolve,
                        reject
                    );
                } else if (reject) {
                    reject();
                }
            };
        },

        list: function (
            params,
            onSuccess,
            onError
        ) {
            var url =
                params.url ||
                (BASE + '/top');

            log.info(
                'list',
                url
            );

            fetchHtml(
                url,

                function (html) {
                    var torrents =
                        parseTorrents(
                            html,
                            getListLimit()
                        );

                    log.group(
                        'Список категории',
                        {
                            url: url,
                            count: torrents.length,
                            limit: getListLimit()
                        }
                    );

                    resolveCards(
                        torrents,

                        function (cards) {
                            onSuccess({
                                results:
                                    cards,

                                page:
                                    params.page || 1,

                                total_pages: 1,

                                total_results:
                                    cards.length,

                                source:
                                    SOURCE
                            });
                        }
                    );
                },

                onError
            );
        },

        full: function (
            params,
            onSuccess,
            onError
        ) {
            Lampa.Api.sources.tmdb.full(
                params,
                onSuccess,
                onError
            );
        },

        clear: function () {
            network.clear();
        }
    };

    // ============================================================
    // Icon
    // ============================================================

    var HAMMER_SICKLE =
        '<svg viewBox="0 0 1258 1280" width="24" height="24" fill="currentColor">' +
        '<g transform="translate(0,1280) scale(1,-1)">' +

        '<path d="M283.1 1274.3c-1.7-3.5-29.3-72.3-42.6-106.5l-5.7-14.7-4.2-.5c-2.2-.3-32.2-1-66.6-1.6-34.4-.7-62.6-1.3-62.8-1.5-.2-.2 11.3-9.6 25.5-21.1 41.8-33.6 67.4-55.6 70.9-60.9 1.4-2.2 1.4-3.4-.6-13.7-2.9-15.6-6.5-29.4-18.5-72.3-12.7-45.5-12.7-45.6-12.2-46.2 1-1 4.1.9 51.1 31.6 42.5 27.8 64.7 41.1 68.5 41.1 4.9 0 18.3-7.9 75.2-44.1 22.4-14.3 41.1-25.9 41.7-25.9 2.2 0-3.6-21.6-16.8-62.5-10.6-32.6-17.9-57.2-18.7-63-.5-3.9-.3-4.3 4.1-8.2 2.6-2.3 16.7-13.3 31.4-24.4 46.2-35.1 65.2-50.4 65.2-52.5 0-2.1-8.6-2.4-70.2-3-43.3-.4-60-.9-60.6-1.7-.5-.7-7.5-18.4-15.6-39.4-8.1-21.1-17.6-45.2-21.1-53.7-6.4-15.4-14.1-31.6-15-31.6-.2 0-1.3 1.7-2.4 3.7z"/>' +

        '<path d="M751 1188.5c0-1.4 4-5.1 27-25.1 15.9-13.8 67.4-65.1 81.1-80.9 39-44.6 70.9-90.3 95.3-136.5 45-85.3 67.6-168.9 67.6-250.5 0-55.2-8-95.6-28.2-143-6.8-15.9-18.3-39.3-25.4-51.6-6.3-10.8-19-27.9-20.8-27.9-.8 0-3.6 2.4-6.3 5.4-2.6 3-18.3 19.7-34.8 37.2-52.5 55.8-168.4 180.7-203 218.9-36.2 39.9-50.2 58.5-47.8 63.5.9 2.1 20 18.3 101.1 85.9 32.6 27.1 59.2 49.7 59 50.2-1 2.6-63.4 68.9-65 68.9-.5 0-9.1-4-19.1-8.9-28.3-14-55.3-24-74.6-27.8-15.8-3.1-37.8-1.7-75 4.7-6.3 1.1-11.9 1.6-12.5 1.3-3.3-2-97.4-79.4-228.4-188.1-72.5-60.1-81.1-67.5-80-69.1 3.4-4.6 112.4-140 114.7-142.4l2.7-2.7 6.4 5.3c47 38.5 74 60.2 85.5 68.9 16.3 12.1 33.1 24.1 36.1 25.6 1.9 1 4-.8 21.5-18.6 72.4-73.2 179.8-188.2 245.8-263.2 8.5-9.6 16.6-18.7 17.9-20.2 3.4-3.8 2.3-4.8-10.4-9.8-21.3-8.3-49.4-14.5-77.3-17.1-19.2-1.7-64.1-.6-83.6 2-49.1 6.6-91 18.3-134.3 37.2-42.7 18.7-70.5 37.5-125.2 84.5-20.3 17.5-30.9 26.1-38.5 31.6-9.8 6.9-5 9.4-45.7-23.9-60.9-49.8-216.4-179.7-266.5-222.5l-9.3-7.9 3.7-7.2c6.6-13.3 21.9-35 41.2-58.7 16.7-20.5 73.4-87 74.1-87 1.1 0 31.2 22.1 55 40.4 30.4 23.4 49.8 39.2 117.5 96 34.6 29 64 53.5 65.3 54.3 1.5 1.1 2.6 1.2 3.5.5 12.7-10.1 59.5-44.9 69.2-51.4 30.6-20.4 67.7-40.1 99-52.6 105-41.9 217.5-46.4 320.5-13 18.3 5.9 31.3 11.1 61.7 24.7 15 6.6 27.7 12.1 28.2 12.1 1.1 0 16.9-17.2 62.6-68 17.6-19.5 39.1-43.4 47.9-53 22-24.1 71.5-76 73.2-76.7 3.8-1.4 127.1 110.8 132.2 120.3.9 1.6-2.5 5.7-22.5 27.4-34.5 37.3-56.2 61.4-89.4 99-54.4 61.8-52.9 60-52.9 63.1 0 6.2 4.7 16.3 27.9 59.4 28.1 52.4 46.6 111.5 54.1 172.9 20.8 169.8-40.5 348.2-165.9 483.3-27.6 29.7-69.5 64.6-109 90.8-40.8 27-78.5 46.2-126.6 64.5-15.2 5.8-20.5 7.2-20.5 5.5z"/>' +

        '</g>' +
        '</svg>';

    // ============================================================
    // Menu
    // ============================================================

    function addMenu() {
        if (
            $('.menu__item[data-action="rutor_top"]').length
        ) {
            return;
        }

        var item = $(
            '<li class="menu__item selector" data-action="rutor_top">' +
                '<div class="menu__ico">' +
                    HAMMER_SICKLE +
                '</div>' +
                '<div class="menu__text">Rutor</div>' +
            '</li>'
        );

        item.on(
            'hover:enter',
            function () {
                if (getViewMode() === 'minimal') {
                    loadMinimalTop();
                } else {
                    Lampa.Activity.push({
                        title: 'Rutor Топ',
                        component: 'category',
                        source: SOURCE,
                        page: 1
                    });
                }
            }
        );

        $('.menu .menu__list')
            .eq(0)
            .append(item);

        log.info(
            'меню добавлено'
        );
    }

    // ============================================================
    // Settings UI
    // ============================================================

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rutor_top',
            name: 'Rutor Топ',
            icon: HAMMER_SICKLE
        });

        // --------------------------------------------------------
        // Proxy
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_proxy',

                type: 'select',

                values: {
                    'https://cors-proxy.gderganov.workers.dev/?url=':
                        'gderganov (по умолчанию)',

                    'https://corsproxy.io/?':
                        'corsproxy.io',

                    'https://api.allorigins.win/raw?url=':
                        'allorigins',

                    '':
                        'Без прокси'
                },

                default:
                    'https://cors-proxy.gderganov.workers.dev/?url='
            },

            field: {
                name: 'CORS Proxy',

                description:
                    'Прокси для запросов к Rutor'
            },

            onChange: function () {
                Lampa.Noty.show(
                    'Прокси сохранён'
                );
            }
        });

        // --------------------------------------------------------
        // Лимит топа
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_limit',

                type: 'select',

                values: {
                    '5': '5',
                    '8': '8',
                    '10': '10',
                    '12': '12',
                    '15': '15'
                },

                default: '10'
            },

            field: {
                name:
                    'Торрентов в ряду (топ)',

                description:
                    'Сколько раздач показывать в каждой категории на главной'
            }
        });

        // --------------------------------------------------------
        // Лимит конкретной категории
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_list_limit',

                type: 'select',

                values: {
                    '20': '20',
                    '30': '30',
                    '40': '40',
                    '50': '50',
                    '60': '60',
                    '80': '80',
                    '100': '100'
                },

                default: '40'
            },

            field: {
                name:
                    'Торрентов в списке категории',

                description:
                    'Сколько раздач загружать при открытии конкретной категории (20–100)'
            }
        });

        // --------------------------------------------------------
        // Режим отображения
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_view',

                type: 'select',

                values: {
                    'cards':
                        'Карточки Lampa',

                    'minimal':
                        'Минималистичный список'
                },

                default: 'cards'
            },

            field: {
                name:
                    'Режим отображения',

                description:
                    'Карточки Lampa — штатные карточки. Минималистичный список — строки как на Rutor'
            },

            onChange: function () {
                Lampa.Noty.show(
                    'Режим сохранён. Откройте Rutor заново'
                );
            }
        });

        // --------------------------------------------------------
        // Cache
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_cache',
                type: 'trigger',
                default: true
            },

            field: {
                name: 'Кеш TMDB',

                description:
                    'Запоминать найденные карточки (7 дней)'
            }
        });

        // --------------------------------------------------------
        // Log
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name: 'rutor_log',

                type: 'select',

                values: {
                    'off':
                        'Выкл',

                    'error':
                        'Только ошибки',

                    'info':
                        'Инфо',

                    'debug':
                        'Отладка'
                },

                default: 'info'
            },

            field: {
                name:
                    'Логирование',

                description:
                    'Уровень логов в консоли разработчика'
            },

            onChange: function (v) {
                log.info(
                    'уровень логов изменён на',
                    v
                );
            }
        });

        // --------------------------------------------------------
        // Clear cache
        // --------------------------------------------------------

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',

            param: {
                name:
                    'rutor_clear_cache',

                type: 'trigger',

                default: false
            },

            field: {
                name:
                    'Очистить кеш TMDB',

                description:
                    'Удалить сохранённые соответствия торрент → карточка'
            },

            onChange: function (v) {
                if (
                    v === true ||
                    v === 'true'
                ) {
                    Lampa.Modal.open({
                        title:
                            'Очистить кеш?',

                        html: $(
                            '<div>' +
                            'Удалить все сохранённые соответствия торрент → карточка TMDB?' +
                            '</div>'
                        ),

                        buttons: [
                            {
                                name:
                                    'Нет',

                                onSelect:
                                    function () {
                                        Lampa.Modal.close();

                                        Lampa.Storage.set(
                                            'rutor_clear_cache',
                                            false
                                        );

                                        Lampa.Controller.toggle(
                                            'settings'
                                        );
                                    }
                            },

                            {
                                name:
                                    'Да',

                                onSelect:
                                    function () {
                                        Lampa.Modal.close();

                                        cache = {};

                                        Lampa.Storage.set(
                                            CACHE_KEY,
                                            {}
                                        );

                                        Lampa.Storage.set(
                                            'rutor_clear_cache',
                                            false
                                        );

                                        Lampa.Noty.show(
                                            'Кеш очищен'
                                        );

                                        log.info(
                                            'кеш очищен вручную'
                                        );

                                        Lampa.Controller.toggle(
                                            'settings'
                                        );
                                    }
                            }
                        ],

                        onBack:
                            function () {
                                Lampa.Modal.close();

                                Lampa.Storage.set(
                                    'rutor_clear_cache',
                                    false
                                );

                                Lampa.Controller.toggle(
                                    'settings'
                                );
                            }
                    });
                }
            }
        });
    }

    // ============================================================
    // Start
    // ============================================================

    function start() {

        // Штатный API
        Lampa.Api.sources[SOURCE] =
            Api;

        // Наши минималистичные компоненты
        if (
            Lampa.Component &&
            Lampa.Component.add
        ) {
            Lampa.Component.add(
                MINIMAL_TOP_COMPONENT,
                MinimalTopComponent
            );

            Lampa.Component.add(
                MINIMAL_LIST_COMPONENT,
                MinimalListComponent
            );
        }

        addSettings();

        if (window.appready) {
            addMenu();
        } else {
            Lampa.Listener.follow(
                'app',
                function (e) {
                    if (e.type === 'ready') {
                        addMenu();
                    }
                }
            );
        }

        log.info(
            'плагин загружен',
            {
                proxy:
                    getProxy(),

                topLimit:
                    getTopLimit(),

                listLimit:
                    getListLimit(),

                view:
                    getViewMode(),

                cache:
                    getCacheEnabled()
            }
        );
    }

    if (window.Lampa) {
        start();
    } else {
        window.addEventListener(
            'appready',
            start
        );
    }

})();
