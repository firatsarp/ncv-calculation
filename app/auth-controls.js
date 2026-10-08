export default function AuthControls() {
  return <div className="authBar">
    <form className="authSession" action="/api/auth/logout" method="post">
      <span className="authStatus"><span className="authDot" aria-hidden="true" />Yetkili oturum</span>
      <button className="logoutButton" type="submit"><span>Çıkış yap</span><span aria-hidden="true">↗</span></button>
    </form>
  </div>;
}
