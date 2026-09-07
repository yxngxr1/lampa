(function () {
    'use strict';

    function RutorPlugin(object) {
        var network = new Lampa.Reguest();
        var scroll  = new Lampa.Scroll({mask: true, over: true});
        var items   = [];
        var html    = $('<div></div>');
        var body    = $('<div class="category-full"></div>');

        this.create = function () {
            var _this = this;
            var domain = 'https://rutor.info';
            // Если пришли из карточки фильма (через поиск), ищем по названию
            var url = object.search ? domain + '/search/0/0/0/0/' + encodeURIComponent(object.search) : domain + '/top';

            network.native(url, function (data) {
                _this.parse(data);
                _this.draw();
                _this.activity.loader(false);
            }, function () {
                Lampa.Noty.show('Ошибка загрузки Rutor');
                _this.activity.loader(false);
            }, false, {dataType: 'text'});

            return this.render();
        };

        this.parse = function (data) {
            var content = $(data.replace(/<img/g, '<source'));
            var table = content.find('#index table tr');
            
            table.each(function (i, row) {
                var link = $(row).find('a[href^="/torrent/"]').last();
                if (link.length) {
                    var title = link.text();
                    var magnet = $(row).find('a[href^="magnet:"]').attr('href');
                    var seeds = $(row).find('.green').text() || '0';
                    
                    items.push({
                        title: title,
                        url: magnet,
                        seeds: seeds,
                        year: title.match(/\((\d{4})\)/) ? title.match(/\((\d{4})\)/)[1] : ''
                    });
                }
            });
        };

        this.draw = function () {
            var _this = this;
            
            // Кнопка ручного поиска
            var search_btn = $('<div class="category-full__title" style="cursor: pointer; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; margin: 10px;">🔍 Поиск по Rutor</div>');
            search_btn.on('click', function() {
                Lampa.Input.edit({value: '', title: 'Поиск'}, function (val) {
                    if (val) Lampa.Activity.push({title: val, component: 'rutor_top', search: val, page: 1});
                });
            });
            body.append(search_btn);

            if (items.length === 0) body.append('<div class="empty" style="text-align:center; margin-top:40px;">Ничего не нашлось</div>');

            items.forEach(function (item) {
                var card = Lampa.Template.get('card', {
                    title: item.title,
                    release_year: 'S: ' + item.seeds + (item.year ? ' | ' + item.year : '')
                });
                card.on('click', function () {
                    Lampa.Torrent.open({title: item.title, url: item.url});
                });
                body.append(card);
            });
            
            scroll.append(body);
            html.append(scroll.render());
        };

        this.render = function () { return html; };

        this.destroy = function () {
            network.clear();
            scroll.destroy();
            html.remove();
            items = [];
        };
    }

    function startPlugin() {
        if (window.appready) {
            if (!Lampa.Component.exist('rutor_top')) {
                Lampa.Component.add('rutor_top', RutorPlugin);
            }

            // 1. Кнопка в ЛЕВОМ меню (основная)
            var menu_item = {
                title: 'Rutor Top',
                icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" fill="white"/></svg>',
                id: 'rutor'
            };
            if ($('.menu [data-id="rutor"]').length === 0) Lampa.Menu.add(menu_item);

            Lampa.Listener.follow('menu', function (e) {
                if (e.type === 'click' && e.item.id === 'rutor') {
                    Lampa.Activity.push({title: 'Rutor Top-100', component: 'rutor_top', page: 1});
                }
            });

            // 2. Кнопка в ПРАВОМ меню (в карточке фильма)
            Lampa.Listener.follow('full', function (e) {
                if (e.type === 'render') {
                    var button = $('<div class="full-start__button selector"><span>Rutor Поиск</span></div>');
                    
                    button.on('click', function () {
                        // Берем название фильма из данных карточки
                        var search_query = e.data.movie.title || e.data.movie.name;
                        Lampa.Activity.push({
                            title: 'Rutor: ' + search_query,
                            component: 'rutor_top',
                            search: search_query,
                            page: 1
                        });
                    });

                    // Добавляем кнопку в блок кнопок карточки
                    e.render.find('.full-start__buttons').append(button);
                }
            });

        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') startPlugin();
            });
        }
    }

    startPlugin();
})();