export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }) {
  const params = await searchParams;
  const messages = {
    invalid: 'Kullanıcı adı veya parola hatalı.',
    unavailable: 'Giriş yapılandırması hazır değil. Yöneticiyle iletişime geçin.',
  };

  return <main className="loginMain">
    <section className="loginShell card">
      <div className="loginBrand">
        <div className="loginMark" aria-hidden="true">NCV</div>
        <div>
          <p className="eyebrow">Istanbul WtE • Waste NCV Engineering Tools</p>
          <h1>NCV Calculation &amp; Scenario Platform</h1>
          <p className="loginIntro">HZI Rev. 3.1 hesaplama ve senaryo araçlarına güvenli erişim.</p>
        </div>
      </div>

      <div className="loginPanel">
        <div className="loginPanelHead">
          <span className="loginStep">01</span>
          <div>
            <p className="eyebrow">Yetkili kullanıcı</p>
            <h2>Oturum açın</h2>
          </div>
        </div>

        {messages[params.error] && <p className="loginAlert" role="alert">{messages[params.error]}</p>}

        <form className="loginForm" action="/api/auth/login" method="post">
          <input type="hidden" name="next" value={params.next || '/'} />
          <label className="loginField">
            <span>Kullanıcı adı</span>
            <input name="username" autoComplete="username" required maxLength={256} autoFocus />
          </label>
          <label className="loginField">
            <span>Parola</span>
            <input type="password" name="password" autoComplete="current-password" required maxLength={1024} />
          </label>
          <button className="loginSubmit" type="submit">
            <span>Giriş yap</span><span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="loginSecurity"><span aria-hidden="true">●</span> Kimlik bilgileri yalnızca güvenli sunucu bağlantısı üzerinden doğrulanır.</p>
      </div>

      <div className="loginMeta">
        <span>HZI 90101284 Rev. 3.1</span>
        <span>Güvenli sunucu oturumu</span>
      </div>
    </section>
  </main>;
}
