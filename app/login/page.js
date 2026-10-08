export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }) {
  const params = await searchParams;
  const messages = {
    invalid: 'Kullanıcı adı veya parola hatalı.',
    unavailable: 'Giriş yapılandırması hazır değil. Yöneticiyle iletişime geçin.',
  };
  return <main style={{ maxWidth: 440, margin: '10vh auto', padding: 24 }}>
    <section className="card">
      <p className="eyebrow">Istanbul WtE • HZI NCV</p>
      <h1>Giriş</h1>
      <p>NCV hesaplama ve senaryo araçlarına erişmek için giriş yapın.</p>
      {messages[params.error] && <p role="alert" style={{ color: 'var(--red)' }}>{messages[params.error]}</p>}
      <form action="/api/auth/login" method="post" style={{ display: 'grid', gap: 16 }}>
        <input type="hidden" name="next" value={params.next || '/'} />
        <label>Kullanıcı adı
          <input name="username" autoComplete="username" required maxLength={256} style={{ display: 'block', width: '100%' }} />
        </label>
        <label>Parola
          <input type="password" name="password" autoComplete="current-password" required maxLength={1024} style={{ display: 'block', width: '100%' }} />
        </label>
        <button type="submit">Giriş yap</button>
      </form>
    </section>
  </main>;
}
