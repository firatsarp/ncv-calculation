export default function AuthControls() {
  return <form action="/api/auth/logout" method="post" style={{ padding: '12px 24px', display: 'flex', justifyContent: 'flex-end' }}>
    <button type="submit">Çıkış yap</button>
  </form>;
}
