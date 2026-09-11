(function () {
    'use strict';

    if (window.rutor_top_plugin) return;
    window.rutor_top_plugin = true;

    var SOURCE = 'rutor_top';
    var BASE = 'http://rutor.info';
    var CACHE_KEY = 'rutor_top_tmdb_cache';
    var CACHE_LIFE = 1000 * 60 * 60 * 24 * 7;

    // ID категорий + сортировка по сидам (/browse/0/{id}/0/2)
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

    // ========== Settings ==========
    function getProxy() {
        return Lampa.Storage.get('rutor_proxy', 'https://cors-proxy.gderganov.workers.dev/?url=') || '';
    }
    function getLimit() {
        var v = parseInt(Lampa.Storage.get('rutor_limit', '10'), 10);
        if (isNaN(v) || v < 1) v = 10;
        if (v > 15) v = 15;
        return v;
    }
    function getCacheEnabled() {
        var v = Lampa.Storage.get('rutor_cache', true);
        return v === true || v === 'true';
    }
    function getLogLevel() {
        return Lampa.Storage.get('rutor_log', 'info') || 'info';
    }

    // ========== Logger (всегда в console, уровень из настроек) ==========
    var log = {
        _ok: function (lvl) {
            var order = { off: 0, error: 1, info: 2, debug: 3 };
            var cur = order[getLogLevel()] || 0;
            return cur >= (order[lvl] || 0);
        },
        info: function () {
            if (this._ok('info')) {
                console.log.apply(console, ['[Rutor]'].concat(Array.prototype.slice.call(arguments)));
            }
        },
        debug: function () {
            if (this._ok('debug')) {
                console.log.apply(console, ['[Rutor:debug]'].concat(Array.prototype.slice.call(arguments)));
            }
        },
        error: function () {
            if (this._ok('error')) {
                console.error.apply(console, ['[Rutor:error]'].concat(Array.prototype.slice.call(arguments)));
            }
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
        // 1. Обрезаем всё после года (год всегда в скобках)
        var yearMatch = name.match(/\((\d{4})(?:\s*[-–]\s*\d{4})?\)/);
        var titlePart = yearMatch ? name.slice(0, yearMatch.index) : name;
    
        // 2. Убираем все блоки в [] (сезоны, эпизоды и т.д.)
        titlePart = titlePart.replace(/\[.*?\]/g, '');
    
        // 3. Оставляем ТОЛЬКО русское название (всё, что до слэша "/")
        titlePart = titlePart.split('/')[0];
    
        // 4. Убираем лишние пробелы и обрезаем
        titlePart = titlePart.replace(/\s+/g, ' ').trim();
    
        // 5. Если после очистки пусто — fallback
        if (!titlePart) {
            titlePart = name.split(/[\(\[]/)[0].split('/')[0].trim();
        }
    
        return titlePart;
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

        log.debug('TMDB search', {
            title: title,
            year: year,
            lang: Lampa.Storage.get('tmdb_lang', 'ru') || 'ru',
            raw: torrentName
        });
        
        if (!title) {
            cache[key] = { ts: now, card: null };
            saveCache();
            return callback(null);
        }
        
        var q = encodeURIComponent(title);
        var lang = Lampa.Storage.get('tmdb_lang', 'ru') || 'ru';
        
        var apiUrl = Lampa.TMDB.api(
            'search/movie?query=' + q +
            (year ? '&year=' + year : '') +
            '&language=' + lang +
            '&api_key=' + Lampa.TMDB.key()
        );
        
        network.silent(apiUrl, function (json) {
            var card = null;
        
            if (json && json.results && json.results.length) {
                card = json.results[0];
        
                if (card) {
                    card.source = SOURCE;
                    card.media_type = 'movie';
                    card.title = card.title || card.name;
                    card.release_date = card.release_date || card.first_air_date;
                }
            }
        
            log.debug('TMDB result', {
                query: title,
                year: year,
                found: card ? (card.title || card.name) : null,
                id: card ? card.id : null
            });
        
            cache[key] = { ts: now, card: card };
            var keys = Object.keys(cache);
            if (keys.length > 700) {
                keys.sort(function (a, b) { return cache[a].ts - cache[b].ts; });
                keys.slice(0, keys.length - 500).forEach(function (k) { delete cache[k]; });
            }
            saveCache();
            callback(card);
        }, function () {
            log.debug('TMDB result', { query: title, year: year, found: null });
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

            // Используем фиксированный URL с сортировкой по сидам
            var href = CAT_MAP[name] || (m[1].startsWith('http') ? m[1] : BASE + m[1]);
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

        category: function (params, onSuccess, onError) {
            var partsData = [];

            fetchHtml(BASE + '/top', function (html) {
                var cats = parseCategories(html);

                log.group('Категории топа (' + cats.length + ')', cats.map(function (c) {
                    return { 
                        title: c.title, 
                        count: c.torrents.length, 
                        url: c.url,
                        torrents: c.torrents.map(function (t) { return t.title; })
                    };
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

                function loadPart(partLoaded, partEmpty) {
                    Lampa.Api.partNext(partsData, 4, partLoaded, partEmpty || onError);
                }

                loadPart(onSuccess, onError);
                Api._next = loadPart;
            }, onError);

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
                log.group('Список категории', { url: url, count: torrents.length });

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
    var HAMMER_SICKLE = '<svg viewBox="0 0 1258 1280" width="24" height="24" fill="currentColor"><g transform="translate(0,1280) scale(0.1,-0.1)"><path d="M283.1 1274.3c-1.7-3.5-29.3-72.3-42.6-106.5l-5.7-14.7-4.2-.5c-2.2-.3-32.2-1-66.6-1.6-34.4-.7-62.6-1.3-62.8-1.5-0.2-0.2 11.3-9.6 25.5-21.1 41.8-33.6 67.4-55.6 70.9-60.9 1.4-2.2 1.4-3.4-.6-13.7-2.9-15.6-6.5-29.4-18.5-72.3-12.7-45.5-12.7-45.6-12.2-46.2 1-1 4.1.9 51.1 31.6 42.5 27.8 64.7 41.1 68.5 41.1 4.9 0 18.3-7.9 75.2-44.1 22.4-14.3 41.1-25.9 41.7-25.9 2.2 0-3.6 21.6-16.8 62.5-10.6 32.6-17.9 57.2-18.7 63-0.5 3.9-0.3 4.3 4.1 8.2 2.6 2.3 16.7 13.3 31.4 24.4 46.2 35.1 65.2 50.4 65.2 52.5 0 2.1-8.6 2.4-70.2 3-43.3.4-60 .9-60.6 1.7-0.5.7-7.5 18.4-15.6 39.4-8.1 21.1-17.6 45.2-21.1 53.7-6.4 15.4-14.1 31.6-15 31.6-0.2 0-1.3-1.7-2.4-3.7z"/><path d="M751 1188.5c0-1.4 4-5.1 27-25.1 15.9-13.8 67.4-65.1 81.1-80.9 39-44.6 70.9-90.3 95.3-136.5 45-85.3 67.6-168.9 67.6-250.5 0-55.2-8-95.6-28.2-143-6.8-15.9-18.3-39.3-25.4-51.6-6.3-10.8-19-27.9-20.8-27.9-0.8 0-3.6 2.4-6.3 5.4-2.6 3-18.3 19.7-34.8 37.2-52.5 55.8-168.4 180.7-203 218.9-36.2 39.9-50.2 58.5-47.8 63.5 0.9 2.1 20 18.3 101.1 85.9 32.6 27.1 59.2 49.7 59 50.2-1 2.6-63.4 68.9-65 68.9-0.5 0-9.1-4-19.1-8.9-28.3-14-55.3-24-74.6-27.8-15.8-3.1-37.8-1.7-75 4.7-6.3 1.1-11.9 1.6-12.5 1.3-3.3-2-97.4-79.4-228.4-188.1-72.5-60.1-81.1-67.5-80-69.1 3.4-4.6 112.4-140 114.7-142.4l2.7-2.7 6.4 5.3c47 38.5 74 60.2 85.5 68.9 16.3 12.1 33.1 24.1 36.1 25.6 1.9 1 4-0.8 21.5-18.6 72.4-73.2 179.8-188.2 245.8-263.2 8.5-9.6 16.6-18.7 17.9-20.2 3.4-3.8 2.3-4.8-10.4-9.8-21.3-8.3-49.4-14.5-77.3-17.1-19.2-1.7-64.1-0.6-83.6 2-49.1 6.6-91 18.3-134.3 37.2-42.7 18.7-70.5 37.5-125.2 84.5-20.3 17.5-30.9 26.1-38.5 31.6-9.8 6.9-5 9.4-45.7-23.9-60.9-49.8-216.4-179.7-266.5-222.5l-9.3-7.9 3.7-7.2c6.6-13.3 21.9-35 41.2-58.7 16.7-20.5 73.4-87 74.1-87 1.1 0 31.2 22.1 55 40.4 30.4 23.4 49.8 39.2 117.5 96 34.6 29 64 53.5 65.3 54.3 1.5 1.1 2.6 1.2 3.5.5 12.7-10.1 59.5-44.9 69.2-51.4 30.6-20.4 67.7-40.1 99-52.6 105-41.9 217.5-46.4 320.5-13 18.3 5.9 31.3 11.1 61.7 24.7 15 6.6 27.7 12.1 28.2 12.1 1.1 0 16.9-17.2 62.6-68 17.6-19.5 39.1-43.4 47.9-53 22-24.1 71.5-76 73.2-76.7 3.8-1.4 127.1 110.8 132.2 120.3 0.9 1.6-2.5 5.7-22.5 27.4-34.5 37.3-56.2 61.4-89.4 99-54.4 61.8-52.9 60-52.9 63.1 0 6.2 4.7 16.3 27.9 59.4 28.1 52.4 46.6 111.5 54.1 172.9 20.8 169.8-40.5 348.2-165.9 483.3-27.6 29.7-69.5 64.6-109 90.8-40.8 27-78.5 46.2-126.6 64.5-15.2 5.8-20.5 7.2-20.5 5.5z"/></g></svg>';

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

        // Proxy как select — избегаем бага с input + длинным default
        Lampa.SettingsApi.addParam({
            component: 'rutor_top',
            param: {
                name: 'rutor_proxy',
                type: 'select',
                values: {
                    'https://cors-proxy.gderganov.workers.dev/?url=': 'gderganov (по умолчанию)',
                    'https://corsproxy.io/?': 'corsproxy.io',
                    'https://api.allorigins.win/raw?url=': 'allorigins',
                    '': 'Без прокси'
                },
                default: 'https://cors-proxy.gderganov.workers.dev/?url='
            },
            field: {
                name: 'CORS Proxy',
                description: 'Прокси для запросов к rutor. К URL добавляется encodeURIComponent'
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
                description: 'Уровень логов в консоли разработчика (F12 → Console)'
            },
            onChange: function (v) {
                log.info('уровень логов изменён на', v);
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
                    Lampa.Modal.open({
                        title: 'Очистить кеш?',
                        html: $('<div>Удалить все сохранённые соответствия торрент → карточка TMDB?</div>'),
                        buttons: [
                            {
                                name: 'Нет',
                                onSelect: function () {
                                    Lampa.Modal.close();
                                    Lampa.Storage.set('rutor_clear_cache', false);
                                }
                            },
                            {
                                name: 'Да',
                                onSelect: function () {
                                    Lampa.Modal.close();
                                    cache = {};
                                    Lampa.Storage.set(CACHE_KEY, {});
                                    Lampa.Storage.set('rutor_clear_cache', false);
                                    Lampa.Noty.show('Кеш очищен');
                                    log.info('кеш очищен вручную');
                                }
                            }
                        ],
                        onBack: function () {
                            Lampa.Modal.close();
                            Lampa.Storage.set('rutor_clear_cache', false);
                        }
                    });
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
