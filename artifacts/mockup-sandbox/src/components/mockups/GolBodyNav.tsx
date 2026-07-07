import { useState } from "react";
import { Menu, X } from "lucide-react";

export default function GolBodyNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'Inter', sans-serif;
        }

        .gol-nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 64px;
          display: flex;
          align-items: center;
          padding: 0 48px;
          background: rgba(13, 31, 45, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(16, 145, 141, 0.15);
          z-index: 1000;
          font-family: 'Inter', sans-serif;
        }

        .gol-nav-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }

        .gol-logo {
          font-size: 22px;
          font-weight: 800;
          background: linear-gradient(90deg, #10918d, #0f734e);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-decoration: none;
          letter-spacing: -0.3px;
          flex-shrink: 0;
        }

        .gol-links {
          display: flex;
          align-items: center;
          gap: 32px;
          list-style: none;
        }

        .gol-links a {
          font-size: 14px;
          font-weight: 400;
          color: #8ab0a8;
          text-decoration: none;
          transition: color 0.2s ease;
          cursor: pointer;
        }

        .gol-links a:hover {
          color: #b8d4cf;
        }

        .gol-cta {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-shrink: 0;
        }

        .gol-btn {
          display: inline-flex;
          align-items: center;
          padding: 8px 24px;
          background: #10918d;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #ffffff;
          text-decoration: none;
          border: none;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: background 0.2s ease, transform 0.1s ease;
          white-space: nowrap;
        }

        .gol-btn:hover {
          background: #0e7f7b;
          transform: translateY(-1px);
        }

        .gol-btn:active {
          transform: translateY(0);
        }

        .gol-menu-icon {
          display: none;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: #8ab0a8;
          padding: 8px;
          border-radius: 8px;
          transition: color 0.2s ease, background 0.2s ease;
        }

        .gol-menu-icon:hover {
          color: #b8d4cf;
          background: rgba(16, 145, 141, 0.08);
        }

        .gol-mobile-menu {
          position: fixed;
          top: 64px;
          left: 0;
          right: 0;
          background: rgba(13, 31, 45, 0.98);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(16, 145, 141, 0.15);
          padding: 16px 48px 24px;
          z-index: 999;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .gol-mobile-link {
          display: block;
          padding: 16px 0;
          font-size: 14px;
          font-weight: 400;
          color: #8ab0a8;
          text-decoration: none;
          border-bottom: 1px solid rgba(16, 145, 141, 0.08);
          cursor: pointer;
          transition: color 0.2s ease;
          font-family: 'Inter', sans-serif;
        }

        .gol-mobile-link:hover {
          color: #b8d4cf;
        }

        .gol-mobile-link:last-child {
          border-bottom: none;
        }

        @media (max-width: 639px) {
          .gol-nav {
            padding: 0 24px;
          }

          .gol-links {
            display: none;
          }

          .gol-menu-icon {
            display: flex;
          }

          .gol-mobile-menu {
            padding: 16px 24px 24px;
          }
        }

        .gol-demo-page {
          min-height: 100vh;
          background: #0D1F2D;
          padding-top: 64px;
          font-family: 'Inter', sans-serif;
        }

        .gol-demo-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: calc(100vh - 64px);
          text-align: center;
          padding: 48px 24px;
        }

        .gol-demo-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: rgba(16, 145, 141, 0.1);
          border: 1px solid rgba(16, 145, 141, 0.25);
          border-radius: 40px;
          font-size: 12px;
          font-weight: 600;
          color: #10918d;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 32px;
        }

        .gol-demo-title {
          font-size: clamp(40px, 6vw, 72px);
          font-weight: 800;
          line-height: 1.1;
          color: #ffffff;
          max-width: 720px;
          margin-bottom: 24px;
          letter-spacing: -1.5px;
        }

        .gol-demo-title span {
          background: linear-gradient(90deg, #10918d, #0f734e);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .gol-demo-subtitle {
          font-size: 18px;
          font-weight: 400;
          color: #8ab0a8;
          max-width: 480px;
          line-height: 1.6;
          margin-bottom: 40px;
        }

        .gol-demo-actions {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
        }

        .gol-btn-outline {
          display: inline-flex;
          align-items: center;
          padding: 8px 24px;
          background: transparent;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #8ab0a8;
          text-decoration: none;
          border: 1px solid rgba(138, 176, 168, 0.25);
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: border-color 0.2s ease, color 0.2s ease;
        }

        .gol-btn-outline:hover {
          border-color: rgba(138, 176, 168, 0.5);
          color: #b8d4cf;
        }
      `}</style>

      <nav className="gol-nav">
        <div className="gol-nav-inner">
          <a href="#" className="gol-logo">GolBody</a>

          <ul className="gol-links">
            <li><a href="#exemples">Exemples</a></li>
            <li><a href="#avis">Avis</a></li>
            <li><a href="#faq">FAQ</a></li>
          </ul>

          <div className="gol-cta">
            <button className="gol-btn">Commencer</button>
            <button
              className="gol-menu-icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="gol-mobile-menu">
          <a href="#exemples" className="gol-mobile-link" onClick={() => setMobileMenuOpen(false)}>Exemples</a>
          <a href="#avis" className="gol-mobile-link" onClick={() => setMobileMenuOpen(false)}>Avis</a>
          <a href="#faq" className="gol-mobile-link" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
        </div>
      )}

      <div className="gol-demo-page">
        <div className="gol-demo-hero">
          <div className="gol-demo-label">Navigation GolBody</div>
          <h1 className="gol-demo-title">
            Transformez votre corps avec <span>GolBody</span>
          </h1>
          <p className="gol-demo-subtitle">
            Le programme sur-mesure qui s'adapte à votre rythme de vie pour des résultats durables.
          </p>
          <div className="gol-demo-actions">
            <button className="gol-btn">Commencer maintenant</button>
            <button className="gol-btn-outline">Voir les exemples</button>
          </div>
        </div>
      </div>
    </>
  );
}
