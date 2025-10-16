import { useNavigation } from '../contexts/NavigationContext';

const wrapperStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "radial-gradient(circle at top left, #f8fafc, #e2e8f0)",
  color: "#0f172a",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "2rem clamp(1.5rem, 5vw, 5rem)",
};

const logoStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "1.25rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const navStyle: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  fontWeight: 500,
};

const linkStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
};

const heroStyle: React.CSSProperties = {
  display: "grid",
  gap: "2rem",
  padding: "0 clamp(1.5rem, 5vw, 5rem) 4rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  alignItems: "center",
  flex: 1,
};

const ctaStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.875rem 1.75rem",
  borderRadius: "999px",
  background: "#2563eb",
  color: "white",
  fontWeight: 600,
  textDecoration: "none",
  marginTop: "1.5rem",
  boxShadow: "0 15px 30px -12px rgba(37, 99, 235, 0.5)",
  cursor: "pointer",
};

const highlightGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "1rem",
  justifyItems: "flex-start",
};

const cardStyle: React.CSSProperties = {
  background: "white",
  padding: "1.5rem",
  borderRadius: "1rem",
  boxShadow: "0 20px 45px -20px rgba(15, 23, 42, 0.25)",
  minWidth: "200px",
};

const footerStyle: React.CSSProperties = {
  padding: "1.5rem",
  textAlign: "center",
  borderTop: "1px solid rgba(15, 23, 42, 0.05)",
  fontSize: "0.875rem",
};

const LandingPage = () => {
  const { navigateTo } = useNavigation();

  return (
    <div style={wrapperStyle}>
      <header style={headerStyle}>
        <span style={logoStyle}>CRM Jurídico</span>
        <nav style={navStyle}>
          <button onClick={() => navigateTo('login')} style={{...linkStyle, background: 'none', border: 'none', cursor: 'pointer'}}>Entrar</button>
          <button onClick={() => navigateTo('login')} style={{...linkStyle, background: 'none', border: 'none', cursor: 'pointer'}}>Criar conta</button>
        </nav>
      </header>

      <main style={heroStyle}>
        <div>
          <h1 style={{ fontSize: "clamp(2.5rem, 5vw, 3.75rem)", marginBottom: "1rem" }}>
            Organize o seu escritório jurídico com eficiência
          </h1>
          <p style={{ maxWidth: "36rem", lineHeight: 1.6, fontSize: "1.05rem" }}>
            Centralize processos, intimações e tarefas em um só lugar. Mantenha sua equipe informada com notificações em tempo real e garanta que nenhum prazo seja perdido.
          </p>
          <button onClick={() => navigateTo('login')} style={{...ctaStyle, border: 'none'}}>
            Começar agora
          </button>
        </div>

        <div style={highlightGridStyle} aria-hidden>
          <div style={cardStyle}>
            <span style={{ fontSize: "2rem", fontWeight: 700 }}>+120</span>
            <small style={{ display: "block", marginTop: "0.25rem", color: "#475569" }}>
              processos ativos
            </small>
          </div>
          <div style={cardStyle}>
            <span style={{ fontSize: "2rem", fontWeight: 700 }}>98%</span>
            <small style={{ display: "block", marginTop: "0.25rem", color: "#475569" }}>
              prazos no prazo
            </small>
          </div>
        </div>
      </main>

      <footer style={footerStyle}>
        <small>© {new Date().getFullYear()} CRM Jurídico</small>
      </footer>
    </div>
  );
};

export default LandingPage;
