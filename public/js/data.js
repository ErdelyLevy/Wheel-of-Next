// js/data.js — Модуль с данными и утилитами

// Функция для генерации плейсхолдера изображения
export function ph(w, h, text = "") {
  const t = encodeURIComponent(text);
  return `https://placehold.co/${w}x${h}${text ? `?text=${t}` : ""}`;
}

// Функция для экранирования HTML
export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Функция для генерации SVG постера
export function svgPoster(title) {
  const safe = escapeHtml(title || "NO IMAGE");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#1b1b2b"/>
          <stop offset="1" stop-color="#0d0d16"/>
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#g)"/>
      <circle cx="650" cy="120" r="140" fill="#ff3cac" opacity="0.18"/>
      <circle cx="140" cy="360" r="180" fill="#ffffff" opacity="0.06"/>
      <text x="60" y="240" fill="#ffffff" font-family="system-ui, sans-serif"
            font-size="44" font-weight="800">${safe}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Функция для получения постера с fallback
export function withFallbackPoster(url, title) {
  return url || svgPoster(title);
}

// Метки источников для ссылок
export const SOURCE_LABELS = {
  portal: "Открыть в базе",
  tmdb: "TMDB",
  igdb: "IGDB",
  mal: "MAL",
  anilist: "AniList",
  imdb: "IMDb",
  google_books: "Google Books",
  goodreads: "Goodreads",
  steam: "Steam",
  hltb: "HLTB",
  metacritic: "Metacritic"
};

export const WEIGHT_LABELS = {
  // ===== Video: TV =====
  continue_tv: {
    title: "Сериал — продолжить",
    hint: "Следующий эпизод/сезон уже начатого сериала"
  },
  new_tv: {
    title: "Сериал — начать новый",
    hint: "Новый сериал (пока не начинал)"
  },
  single_tv: {
    title: "Фильм — самостоятельный",
    hint: "Отдельный фильм без сиквелов/франшизы"
  },

  // ===== Video: Anime (как сериал) =====
  continue_anime: {
    title: "Аниме-сериал — продолжить",
    hint: "Следующий эпизод/сезон уже начатого аниме"
  },
  new_anime: {
    title: "Аниме-сериал — начать новое",
    hint: "Новое аниме (пока не начинал)"
  },
  single_anime: {
    title: "Аниме-фильм / standalone",
    hint: "Отдельный фильм/история без продолжений"
  },

  // ===== Games (оставил в том же стиле, но можно переименовать под тебя) =====
  continue_game: {
    title: "Игра — продолжить",
    hint: "Уже начатая игра"
  },
  new_game: {
    title: "Игра — начать новую",
    hint: "Новая игра (ещё не запускал)"
  },
  single_game: {
    title: "Игра — одиночная/самостоятельная",
    hint: "Самостоятельная игра (не серия/не продолжение)"
  },

  // ===== Books =====
  continue_book: {
    title: "Книжная серия — продолжить",
    hint: "Следующая книга уже начатой серии"
  },
  new_book: {
    title: "Книжная серия — начать новую",
    hint: "Новая серия книг (пока не начинал)"
  },
  single_book: {
    title: "Книга — самостоятельная",
    hint: "Отдельная книга без продолжений/серии"
  }
};

export const CATEGORY_WEIGHTS_DEFAULTS = {
  // video
  continue_tv: 6,
  new_tv: 2,
  single_tv: 4,

  continue_anime: 3,
  new_anime: 1,
  single_anime: 2,

  // ✅ games: единые веса, без платформ
  continue_game: 3,
  new_game: 2,
  single_game: 4,

  // Books
  new_book: 2,
  single_book: 2,
  continue_book: 3
};

// мок-данные (временно вместо API)
export const mockData = [
  // Games
  {
    id: 101,
    meta_id: "met_game_pc_01",
    title: "Hades",
    media_type: "game",
    platform: "pc",
    category: "single_game_pc",
    poster: withFallbackPoster(ph(800, 450, "Hades"), "Hades"),
    year: 2020,
    genres: ["Action", "Roguelike"],
    tags: ["Fast", "Mythology"],
    description: "Мок-описание игры.",
    sources: [{ source: "igdb", source_url: "https://www.igdb.com/" }]
  },
  {
    id: 102,
    meta_id: "met_game_deck_01",
    title: "Balatro",
    media_type: "game",
    platform: "deck",
    category: "new_game_deck",
    poster: withFallbackPoster(ph(800, 450, "Balatro"), "Balatro"),
    year: 2024,
    genres: ["Cards", "Indie"],
    tags: ["Deck", "Roguelike"],
    description: "Мок-описание игры (Deck).",
    sources: [{ source: "steam", source_url: "https://store.steampowered.com/" }]
  },

  // Video
  {
    id: 201,
    meta_id: "met_tv_01",
    title: "Breaking Bad",
    media_type: "tv",
    category: "continue_tv",
    poster: withFallbackPoster(ph(800, 450, "Breaking Bad"), "Breaking Bad"),
    year: 2008,
    genres: ["Crime", "Drama"],
    tags: ["Antihero"],
    description: "Мок-описание сериала.",
    sources: [
      { source: "tmdb", source_url: "https://www.themoviedb.org/" },
      { source: "imdb", source_url: "https://www.imdb.com/" }
    ]
  },
  {
    id: 202,
    meta_id: "met_anime_01",
    title: "Vinland Saga",
    media_type: "anime",
    category: "single_anime",
    poster: withFallbackPoster(ph(800, 450, "Vinland Saga"), "Vinland Saga"),
    year: 2019,
    genres: ["Action", "Drama"],
    tags: ["Vikings"],
    description: "Мок-описание аниме.",
    sources: [{ source: "mal", source_url: "https://myanimelist.net/" }]
  },

  // Books
  {
    id: 301,
    meta_id: "met_book_01",
    title: "Dune",
    media_type: "book",
    category: "new_book",
    poster: withFallbackPoster(ph(800, 450, "Dune"), "Dune"),
    year: 1965,
    genres: ["Sci-Fi"],
    tags: ["Politics"],
    description: "Мок-описание книги.",
    sources: [
      { source: "google_books", source_url: "https://books.google.com/" },
      { source: "goodreads", source_url: "https://www.goodreads.com/" }
    ]
  }
];
