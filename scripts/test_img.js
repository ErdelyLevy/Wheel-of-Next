(async () => {
  try {
    const url = 'http://127.0.0.1:3000/img?url=' + encodeURIComponent('https://cdn.myanimelist.net/images/anime/1889/105337l.webp');
    const r = await fetch(url);
    console.log('STATUS', r.status);
    console.log('HEADERS', Object.fromEntries(r.headers.entries()));
    const text = await r.text().catch(() => '<binary>');
    console.log('BODY-START', text.slice(0,400));
  } catch (e) {
    console.error('ERR', e);
  }
})();
