(function () {
    'use strict';

    if (window.rutor_top_plugin) return;
    window.rutor_top_plugin = true;

    var SOURCE = 'rutor_top';
    var BASE = 'http://rutor.info';
    var CACHE_KEY = 'rutor_top_tmdb_cache';
    var CACHE_LIFE = 1000 * 60 * 60 * 24 * 7;
    var NEEDED = [
        'Зарубежные фильмы',
        'Наши фильмы',
        'Зарубежные сериалы',
        'Наши сериалы',
        'Научно-популярные фильмы',
        'Телевизор',
        'Мультипликация',
        'Аниме'
    ];

    // возможные прокси (попробует по очереди)
    var PROXIES = [
        function (url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
        function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
        function (url) { return url; } // прямой (на случай если CORS уже ок)
    ];

    var network = new Lampa.Reguest();
    var cache = Lampa.Storage.get(CACHE_KEY, {});

    function saveCache() {
        Lampa.Storage.set(CACHE_KEY, cache);
    }

    // чистим название: всё после первого технического маркера — отбрасываем
    function cleanTitle(name) {
        var markers = [
            'WEB-DLRip-AVC', 'WEBRip-AVC', 'WEB-DLRip', 'WEBRip', 'WEB-DL',
            'BDRip', 'HDRip', 'DVDRip', 'BDRemux', 'Remux', 'HDTVRip', 'HDTV',
            '720p', '1080p', '2160p', '4K', 'UHD', 'HDR10', 'HDR', 'HEVC', 'x264', 'x265', 'AVC',
            'RePack', 'Repack', 'by ', 'от ', '|', '[S0', '[S1', '[S2', '[S3', '[S4', '[S5',
            'LostFilm', 'NewStudio', 'HDRezka', 'Кравец', 'DoMiNo', 'селезень'
        ];

        var cutPos = name.length;
        markers.forEach(function (m) {
            var idx = name.toLowerCase().indexOf(m.toLowerCase());
            if (idx !== -1 && idx < cutPos) cutPos = idx;
        });

        var cleaned = name.slice(0, cutPos)
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\/.*$/, '')          // убираем английское название после /
            .replace(/\s+/g, ' ')
            .trim();

        // если осталось пусто — берём первую часть до /
        if (!cleaned) {
            cleaned = name.split('/')[0].replace(/\[.*?\]/g, '').trim();
        }

        return cleaned;
    }

    function getYear(name) {
        // (2022-2024) или (2022)
        var m = name.match(/\((\d{4})(?:\s*[-–]\s*\d{4})?\)/);
        return m ? m[1] : '';
    }

    function fetchHtml(url, success, error) {
        var i = 0;

        function tryNext() {
            if (i >= PROXIES.length) {
                console.log('[Rutor] все прокси провалились для', url);
                return error && error('CORS / proxy fail');
            }

            var proxied = PROXIES[i++](url);
            console.log('[Rutor] запрос:', proxied);

            network.silent(proxied, function (html) {
                if (typeof html === 'string' && html.length > 500) {
                    success(html);
                } else {
                    console.log('[Rutor] пустой/короткий ответ, пробуем следующий прокси');
                    tryNext();
                }
            }, function (err) {
                console.log('[Rutor] ошибка прокси:', err);
                tryNext();
            }, false, {
                dataType: 'text',
                timeout: 10000
            });
        }

        tryNext();
    }

    function searchTMDB(torrentName, callback) {
        var key = torrentName.toLowerCase().slice(0, 100);
        var now = Date.now();

        if (cache[key] && (now - cache[key].ts) < CACHE_LIFE) {
            return callback(cache[key].card || null);
        }

        var title = cleanTitle(torrentName);
        var year = getYear(torrentName);

        console.log('[Rutor TMDB] title:', title, '| year:', year, '| raw:', torrentName);

        if (!title) {
            cache[key] = { ts: now, card: null };
            saveCache();
            return callback(null);
        }

        var q = encodeURIComponent(title);
        var url = Lampa.TMDB.api(
            'search/multi?query=' + q +
            (year ? '&year=' + year : '') +
            '&language=' + (Lampa.Storage.get('tmdb_lang', 'ru') || 'ru') +
            '&api_key=' + Lampa.TMDB.key()
        );

        network.silent(url, function (json) {
            var card = null;
            if (json && json.results && json.results.length) {
                card = json.results.find(function (r) {
                    return r.media_type === 'movie' || r.media_type === 'tv';
                }) || json.results[0];

                if (card) {
                    card.source = SOURCE;
                    if (card.media_type === 'tv') {
                        card.name = card.name || card.title;
                        card.first_air_date = card.first_air_date || card.release_date;
                    } else {
                        card.title = card.title || card.name;
                        card.release_date = card.release_date || card.first_air_date;
                    }
                }
            }

            cache[key] = { ts: now, card: card };
            var keys = Object.keys(cache);
            if (keys.length > 600) {
                keys.sort(function (a, b) { return cache[a].ts - cache[b].ts; });
                keys.slice(0, keys.length - 500).forEach(function (k) { delete cache[k]; });
            }
            saveCache();
            callback(card);
        }, function () {
            cache[key] = { ts: now, card: null };
            saveCache();
            callback(null);
        });
    }

    function parseTorrents(html, limit) {
        limit = limit || 30;
        var list = [];
        var rowRegex = /<tr class="(?:gai|tum)">([\s\S]*?)<\/tr>/g;
        var m, i = 0;

        while ((m = rowRegex.exec(html)) !== null && i < limit) {
            var row = m[1];
            var titleM = row.match(/<a href="(\/torrent\/[^"]+)">([^<]+)<\/a>/);
            if (!titleM) continue;

            list.push({
                title: titleM[2].trim(),
                url: BASE + titleM[1],
                seeds: (row.match(/arrowup\.gif[^>]*>[\s\u00a0]*(\d+)/) || [])[1] || '0',
                leeches: (row.match(/arrowdown\.gif[^>]*>[\s\u00a0]*(?:<span[^>]*>)?[\s\u00a0]*(\d+)/) || [])[1] || '0'
            });
            i++;
        }
        return list;
    }

    function parseCategories(html) {
        var cats = [];
        var catRegex = /в категории <a href="?([^">]+)"?>([^<]+)<\/a><\/h2>([\s\S]*?)(?=<h2>|$)/g;
        var m;

        while ((m = catRegex.exec(html)) !== null) {
            var name = m[2];
            if (NEEDED.indexOf(name) === -1) continue;

            var href = m[1].startsWith('http') ? m[1] : BASE + m[1];
            var torrents = parseTorrents(m[3], 12);

            cats.push({ title: name, url: href, torrents: torrents });
        }
        return cats;
    }

    function resolveCards(torrents, done) {
        var results = [];
        var left = torrents.length;
        if (!left) return done([]);

        torrents.forEach(function (t, idx) {
            searchTMDB(t.title, function (card) {
                if (card) {
                    card.rutor = t;
                    results[idx] = card;
                }
                left--;
                if (left <= 0) done(results.filter(Boolean));
            });
        });
    }

    var Api = {
        network: network,

        category: function (params, onSuccess, onError) {
            fetchHtml(BASE + '/top', function (html) {
                var cats = parseCategories(html);

                console.log('[Rutor] === Категории топа ===');
                cats.forEach(function (c) {
                    console.log('▶', c.title, '(' + c.torrents.length + ')');
                    c.torrents.forEach(function (t, i) {
                        console.log('  ', (i + 1) + '.', t.title);
                    });
                });

                var parts = cats.map(function (cat) {
                    return function (call) {
                        resolveCards(cat.torrents, function (cards) {
                            call({
                                title: cat.title,
                                results: cards,
                                page: 1,
                                total_pages: 1,
                                more: true,
                                url: cat.url,
                                source: SOURCE
                            });
                        });
                    };
                });

                Lampa.Api.partNext(parts, 3, onSuccess, onError);
            }, onError);
        },

        list: function (params, onSuccess, onError) {
            var url = params.url || (BASE + '/top');

            fetchHtml(url, function (html) {
                var torrents = parseTorrents(html, 40);

                console.log('[Rutor] === Список категории ===', url);
                torrents.forEach(function (t, i) {
                    console.log((i + 1) + '.', t.title);
                });

                resolveCards(torrents, function (cards) {
                    onSuccess({
                        results: cards,
                        page: params.page || 1,
                        total_pages: 1,
                        total_results: cards.length,
                        source: SOURCE
                    });
                });
            }, onError);
        },

        full: function (params, onSuccess, onError) {
            Lampa.Api.sources.tmdb.full(params, onSuccess, onError);
        },

        clear: function () {
            network.clear();
        }
    };

    function addMenu() {
        var item = $('<li class="menu__item selector">' +
            '<div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l-10 5 10 5 10-5-10-5z"/></svg></div>' +
            '<div class="menu__text">Rutor</div></li>');

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                title: 'Rutor Топ',
                component: 'category',
                source: SOURCE,
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(item);
    }

    function start() {
        Lampa.Api.sources[SOURCE] = Api;
        if (window.appready) addMenu();
        else Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') addMenu();
        });
    }

    if (window.Lampa) start();
    else window.addEventListener('appready', start);
})();
