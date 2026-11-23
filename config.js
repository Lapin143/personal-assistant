// Адрес функции-прокси в Yandex Cloud и имя таблицы.
// Секретов здесь нет: токен Tabrica, ID базы и таблиц, пароли хранятся в переменных окружения функции.
export const API = {
  url: 'https://functions.yandexcloud.net/d4e4m399l6s8fn9mdfbk',
  // Изолированный прокси новой базы. Рабочее хранилище переключается только в приложении.
  backupUrl: 'https://functions.yandexcloud.net/d4eunltrtigqq970l3f8',
  table: 'records'
};
