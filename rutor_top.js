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

    var network = new Lampa.Reguest();
    var cache = Lampa.Storage.get(CACHE_KEY, {});

    // ========== Settings ==========
    function getProxy() {
        return Lampa.Storage.get('rutor_proxy', 'https://cors-proxy.gderganov.workers.dev/?url=');
    }
    function getLimit() {
        var v = parseInt(Lampa.Storage.get('rutor_limit', '10'), 10);
        if (isNaN(v) || v < 1) v = 10;
        if (v > 15) v = 15;
        return v;
    }
    function getCacheEnabled() {
        return Lampa.Storage.get('rutor_cache', 'true') === 'true' || Lampa.Storage.get('rutor_cache', true) === true;
    }
    function getLogLevel() {
        return Lampa.Storage.get('rutor_log', 'info'); // off | error | info | debug
    }

    // ========== Logger ==========
    var log = {
        _ok: function (lvl) {
            var order = { off: 0, error: 1, info: 2, debug: 3 };
            return (order[getLogLevel()] || 0) >= (order[lvl] || 0);
        },
        info: function () {
            if (this._ok('info')) console.log.apply(console, ['[Rutor]'].concat([].slice.call(arguments)));
        },
        debug: function () {
            if (this._ok('debug')) console.log.apply(console, ['[Rutor:debug]'].concat([].slice.call(arguments)));
        },
        error: function () {
            if (this._ok('error')) console.error.apply(console, ['[Rutor:error]'].concat([].slice.call(arguments)));
        },
        group: function (title, obj) {
            if (!this._ok('info')) return;
            console.groupCollapsed('[Rutor] ' + title);
            if (obj !== undefined) console.log(obj);
            console.groupEnd();
        }
    };

    function saveCache() {
        if (getCacheEnabled()) Lampa.Storage.set(CACHE_KEY, cache);
    }

    // ========== Title cleaner ==========
    function cleanTitle(name) {
        var markers = [
            'WEB-DLRip-AVC', 'WEBRip-AVC', 'WEB-DLRip', 'WEBRip', 'WEB-DL',
            'BDRip', 'HDRip', 'DVDRip', 'BDRemux', 'Remux', 'HDTVRip', 'HDTV',
            '720p', '1080p', '2160p', '4K', 'UHD', 'HDR10', 'HDR', 'HEVC', 'x264', 'x265', 'AVC',
            'RePack', 'Repack', 'by ', 'от ', '|',
            '[S0', '[S1', '[S2', '[S3', '[S4', '[S5', '[S6',
            'LostFilm', 'NewStudio', 'HDRezka', 'Кравец', 'DoMiNo', 'селезень', 'New-Team', 'WinMedia'
        ];

        var cutPos = name.length;
        var lower = name.toLowerCase();
        markers.forEach(function (m) {
            var idx = lower.indexOf(m.toLowerCase());
            if (idx !== -1 && idx < cutPos) cutPos = idx;
        });

        var cleaned = name.slice(0, cutPos)
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\/.*$/, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned) cleaned = name.split('/')[0].replace(/\[.*?\]/g, '').trim();
        return cleaned;
    }

    function getYear(name) {
        var m = name.match(/\((\d{4})(?:\s*[-–]\s*\d{4})?\)/);
        return m ? m[1] : '';
    }

    // ========== Network ==========
    function fetchHtml(url, success, error) {
        var proxyBase = getProxy();
        var finalUrl = proxyBase ? (proxyBase + encodeURIComponent(url)) : url;

        log.debug('fetch', finalUrl);

        network.silent(finalUrl, function (html) {
            if (typeof html === 'string' && html.length > 300) {
                success(html);
            } else {
                log.error('empty response', url);
                error && error('empty');
            }
        }, function (err) {
            log.error('request failed', url, err);
            error && error(err);
        }, false, {
            dataType: 'text',
            timeout: 15000
        });
    }

    // ========== TMDB ==========
    function searchTMDB(torrentName, callback) {
        var key = torrentName.toLowerCase().slice(0, 120);
        var now = Date.now();

        if (getCacheEnabled() && cache[key] && (now - cache[key].ts) < CACHE_LIFE) {
            log.debug('cache hit', cleanTitle(torrentName));
            return callback(cache[key].card || null);
        }

        var title = cleanTitle(torrentName);
        var year = getYear(torrentName);

        log.debug('TMDB search', { title: title, year: year, raw: torrentName });

        if (!title) {
            cache[key] = { ts: now, card: null };
            saveCache();
            return callback(null);
        }

        var q = encodeURIComponent(title);
        var apiUrl = Lampa.TMDB.api(
            'search/multi?query=' + q +
            (year ? '&year=' + year : '') +
            '&language=' + (Lampa.Storage.get('tmdb_lang', 'ru') || 'ru') +
            '&api_key=' + Lampa.TMDB.key()
        );

        network.silent(apiUrl, function (json) {
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
            if (keys.length > 700) {
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

    // ========== Parser ==========
    function parseTorrents(html, limit) {
        limit = limit || getLimit();
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
            cats.push({
                title: name,
                url: href,
                torrents: parseTorrents(m[3], getLimit())
            });
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

    // ========== API Source ==========
    var Api = {
        network: network,

        // Важно: возвращаем функцию loadPart
        category: function (params, onSuccess, onError) {
            var partsData = [];

            fetchHtml(BASE + '/top', function (html) {
                var cats = parseCategories(html);

                log.group('Категории топа (' + cats.length + ')', cats.map(function (c) {
                    return { title: c.title, count: c.torrents.length, url: c.url, torrents: c.torrents.map(function (t) { return t.title; }) };
                }));

                cats.forEach(function (cat) {
                    partsData.push(function (call) {
                        resolveCards(cat.torrents, function (cards) {
                            log.info('ряд готов:', cat.title, '→', cards.length, 'карточек');
                            call({
                                title: cat.title,
                                results: cards,
                                page: 1,
                                total_pages: 2,
                                more: true,
                                url: cat.url,
                                source: SOURCE
                            });
                        });
                    });
                });

                // progressive load
                function loadPart(partLoaded, partEmpty) {
                    Lampa.Api.partNext(partsData, 4, partLoaded, partEmpty || onError);
                }

                // первый вызов
                loadPart(onSuccess, onError);

                // сохраняем для onNext
                Api._next = loadPart;
            }, onError);

            // пока грузим html — отдаём заглушку next
            return function (resolve, reject) {
                if (Api._next) Api._next(resolve, reject);
                else reject && reject();
            };
        },

        list: function (params, onSuccess, onError) {
            var url = params.url || (BASE + '/top');
            log.info('list', url);

            fetchHtml(url, function (html) {
                var torrents = parseTorrents(html, 40);
                log.group('Список категории', { url: url, count: torrents.length, items: torrents.map(function (t) { return t.title; }) });

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

    // ========== Menu ==========
    var HAMMER_SICKLE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12.5 2l1.5 4h4l-3 3 1.5 4-4-2.5L8.5 13l1.5-4-3-3h4L12.5 2zM4 14l2 1 3-1-1 3 2 2-3-1-1 3-1-3-3 1 2-2-1-3 3 1z"/></svg>';

    function addMenu() {
        if ($('.menu__item[data-action="rutor_top"]').length) return;

        var item = $('<li class="menu__item selector" data-action="rutor_top">' +
            '<div class="menu__ico">' + HAMMER_SICKLE + '</div>' +
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
        log.info('меню добавлено');
    }

    // ========== Settings UI ==========
    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rutor_top',
            name: 'Rutor Топ',
            icon: HAMMER_SICKLE
        });

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',
            param: {
                name: 'rutor_proxy',
                type: 'input',
                default: 'https://cors-proxy.gderganov.workers.dev/?url=',
                placeholder: 'https://your-proxy/?url='
            },
            field: {
                name: 'CORS Proxy',
                description: 'Адрес прокси. К URL автоматически добавится encodeURIComponent(целевой_адрес)'
            },
            onChange: function () {
                Lampa.Noty.show('Прокси сохранён');
            }
        });

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
                name: 'Торрентов в ряду',
                description: 'Сколько раздач брать из категории (макс. 15)'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',
            param: {
                name: 'rutor_cache',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Кеш TMDB',
                description: 'Запоминать найденные карточки (7 дней)'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',
            param: {
                name: 'rutor_log',
                type: 'select',
                values: {
                    'off': 'Выкл',
                    'error': 'Только ошибки',
                    'info': 'Инфо',
                    'debug': 'Отладка'
                },
                default: 'info'
            },
            field: {
                name: 'Логирование',
                description: 'Уровень логов в консоли'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rutor_top',
            param: {
                name: 'rutor_clear_cache',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Очистить кеш TMDB',
                description: 'Удалить сохранённые соответствия торрент → карточка'
            },
            onChange: function (v) {
                if (v === true || v === 'true') {
                    cache = {};
                    Lampa.Storage.set(CACHE_KEY, {});
                    Lampa.Storage.set('rutor_clear_cache', false);
                    Lampa.Noty.show('Кеш очищен');
                    log.info('кеш очищен вручную');
                }
            }
        });
    }

    // ========== Start ==========
    function start() {
        Lampa.Api.sources[SOURCE] = Api;
        addSettings();

        if (window.appready) addMenu();
        else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') addMenu();
            });
        }

        log.info('плагин загружен', {
            proxy: getProxy(),
            limit: getLimit(),
            cache: getCacheEnabled(),
            log: getLogLevel()
        });
    }

    if (window.Lampa) start();
    else window.addEventListener('appready', start);
})();
