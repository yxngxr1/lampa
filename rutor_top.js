(function () {
    'use strict';

    if (window.rutor_top_plugin) return;
    window.rutor_top_plugin = true;

    var SOURCE = 'rutor_top';
    var BASE = 'http://rutor.info';
    var CACHE_KEY = 'rutor_top_tmdb_cache';
    var CACHE_LIFE = 1000 * 60 * 60 * 24 * 7; // 7 дней
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

    function saveCache() {
        Lampa.Storage.set(CACHE_KEY, cache);
    }

    function cleanTitle(name) {
        return name
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\b(720p|1080p|2160p|4K|UHD|HDR|HEVC|x264|x265|WEB-DL|BDRip|HDRip|DVDRip|Remux|RePack|by|от)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getYear(name) {
        var m = name.match(/\((\d{4})\)/);
        return m ? m[1] : '';
    }

    function searchTMDB(torrentName, callback) {
        var key = torrentName.toLowerCase().slice(0, 80);
        var now = Date.now();

        if (cache[key] && (now - cache[key].ts) < CACHE_LIFE) {
            return callback(cache[key].card || null);
        }

        var title = cleanTitle(torrentName);
        var year = getYear(torrentName);
        var query = encodeURIComponent(title);
        var url = Lampa.TMDB.api('search/multi?query=' + query + (year ? '&year=' + year : '') + '&language=' + (Lampa.Storage.get('tmdb_lang', 'ru') || 'ru') + '&api_key=' + Lampa.TMDB.key());

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
            // ограничиваем размер кеша
            var keys = Object.keys(cache);
            if (keys.length > 500) {
                keys.sort(function (a, b) { return cache[a].ts - cache[b].ts; });
                keys.slice(0, keys.length - 400).forEach(function (k) { delete cache[k]; });
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
        limit = limit || 20;
        var list = [];
        var rowRegex = /<tr class="(?:gai|tum)">([\s\S]*?)<\/tr>/g;
        var m, i = 0;

        while ((m = rowRegex.exec(html)) !== null && i < limit) {
            var row = m[1];
            var titleM = row.match(/<a href="(\/torrent\/[^"]+)">([^<]+)<\/a>/);
            if (!titleM) continue;

            var link = BASE + titleM[1];
            var name = titleM[2].trim();
            var seedM = row.match(/arrowup\.gif[^>]*>[\s\u00a0]*(\d+)/);
            var leechM = row.match(/arrowdown\.gif[^>]*>[\s\u00a0]*(?:<span[^>]*>)?[\s\u00a0]*(\d+)/);
            var sizeM = row.match(/([\d.,]+\s*(?:GB|MB|TB|KB))/i);

            list.push({
                title: name,
                url: link,
                seeds: seedM ? seedM[1] : '0',
                leeches: leechM ? leechM[1] : '0',
                size: sizeM ? sizeM[1] : ''
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
            var torrents = parseTorrents(m[3], 10);

            cats.push({
                title: name,
                url: href,
                torrents: torrents
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
                if (left <= 0) {
                    done(results.filter(Boolean));
                }
            });
        });
    }

    // === Source API ===
    var Api = {
        network: network,

        category: function (params, onSuccess, onError) {
            network.silent(BASE + '/top', function (html) {
                var cats = parseCategories(html);
                var parts = [];
                
                cats.forEach(function (cat) {
                    parts.push(function (call) {
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
                    });
                });

                Lampa.Api.partNext(parts, 3, onSuccess, onError);
            }, onError, false, { dataType: 'text', cache: { life: 60 } });
        },

        list: function (params, onSuccess, onError) {
            var url = params.url || (BASE + '/top');
            var page = params.page || 1;

            network.silent(url, function (html) {
                // для страницы категории берём все строки
                var torrents = parseTorrents(html, 40);
                resolveCards(torrents, function (cards) {
                    onSuccess({
                        results: cards,
                        page: page,
                        total_pages: page, // rutor топ не пагинируется просто
                        total_results: cards.length,
                        source: SOURCE
                    });
                });
            }, onError, false, { dataType: 'text', cache: { life: 30 } });
        },

        full: function (params, onSuccess, onError) {
            // делегируем в TMDB
            Lampa.Api.sources.tmdb.full(params, onSuccess, onError);
        },

        clear: function () {
            network.clear();
        }
    };

    function addMenu() {
        var item = $('<li class="menu__item selector" data-action="rutor_top">' +
            '<div class="menu__ico">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div class="menu__text">Rutor</div>' +
            '</li>');

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
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
        else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') addMenu();
            });
        }
    }

    if (window.Lampa) start();
    else {
        window.addEventListener('appready', start);
    }
})();
