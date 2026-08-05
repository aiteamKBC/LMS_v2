import { forwardRef } from 'react';

interface BadgeShareCardProps {
  badge: {
    title: string;
    description: string;
    icon: string;
    color: string;
    earnedDate: string;
    category: string;
    impact?: string;
  };
  userName: string;
  userRole: string;
}

const colorMap: Record<string, { icon: string; glow: string }> = {
  primary: { icon: '#3b82f6', glow: '#3b82f6' },
  accent: { icon: '#f59e0b', glow: '#f59e0b' },
  secondary: { icon: '#10b981', glow: '#10b981' },
};

const BadgeShareCard = forwardRef<HTMLDivElement, BadgeShareCardProps>(
  ({ badge, userName, userRole }, ref) => {
    const colors = colorMap[badge.color] || colorMap.primary;
    const shortDesc = badge.description.length > 100 ? badge.description.slice(0, 97) + '...' : badge.description;

    return (
      <div
        ref={ref}
        style={{
          width: '800px',
          height: '800px',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '"DM Sans", system-ui, sans-serif',
          background: '#0a0a0f',
        }}
      >
        {/* Animated background gradient */}
        <div
          style={{
            position: 'absolute',
            inset: '0',
            background: 'radial-gradient(ellipse 80% 60% at 50% 20%, #1a1a2e 0%, #0a0a0f 50%, #000000 100%)',
          }}
        />

        {/* Subtle grid pattern */}
        <div
          style={{
            position: 'absolute',
            inset: '0',
            opacity: 0.03,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        {/* Top accent glow */}
        <div
          style={{
            position: 'absolute',
            top: '-120px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${colors.glow}30 0%, transparent 70%)`,
            filter: 'blur(60px)',
          }}
        />

        {/* Bottom glow */}
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            right: '-80px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.12) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />

        {/* Content wrapper */}
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 56px',
          }}
        >
          {/* KBC Logo Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '48px' }}>
            {/* KBC Badge Icon */}
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #1a1a2e 0%, #252545 100%)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
            >
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  color: '#ffffff',
                  fontFamily: '"DM Sans", system-ui, sans-serif',
                }}
              >
                KBC
              </span>
            </div>
            <div>
              <p
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#ffffff',
                  letterSpacing: '0.5px',
                  lineHeight: 1,
                }}
              >
                Knowledge &amp; Business Centre
              </p>
              <p
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.35)',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  marginTop: '3px',
                }}
              >
                Apprenticeship Excellence
              </p>
            </div>
          </div>

          {/* Achievement Unlocked Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 20px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              marginBottom: '40px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: colors.glow,
                boxShadow: `0 0 8px ${colors.glow}`,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.6)',
                letterSpacing: '2.5px',
                textTransform: 'uppercase',
              }}
            >
              Achievement Unlocked
            </span>
          </div>

          {/* Badge Icon */}
          <div
            style={{
              width: '140px',
              height: '140px',
              borderRadius: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '36px',
              position: 'relative',
              background: `linear-gradient(135deg, ${colors.glow}18 0%, ${colors.glow}08 100%)`,
              boxShadow: `0 8px 40px ${colors.glow}25, 0 0 0 1px ${colors.glow}15`,
            }}
          >
            {/* Icon circle */}
            <div
              style={{
                width: '100px',
                height: '100px',
                borderRadius: '24px',
                background: `linear-gradient(135deg, ${colors.glow}20 0%, ${colors.glow}08 100%)`,
                border: `1px solid ${colors.glow}25`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppIcon
                className={badge.icon}
                style={{
                  fontSize: '44px',
                  color: colors.icon,
                  lineHeight: 1,
                }}
              />
            </div>
            {/* Orbiting ring */}
            <div
              style={{
                position: 'absolute',
                inset: '-8px',
                borderRadius: '40px',
                border: `1px solid ${colors.glow}12`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: '-16px',
                borderRadius: '48px',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            />
          </div>

          {/* Badge Title */}
          <h2
            style={{
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              textAlign: 'center',
              lineHeight: 1.2,
              marginBottom: '16px',
              letterSpacing: '-0.5px',
              maxWidth: '640px',
            }}
          >
            {badge.title}
          </h2>

          {/* Description */}
          <p
            style={{
              fontSize: '16px',
              color: 'rgba(255,255,255,0.55)',
              textAlign: 'center',
              lineHeight: 1.6,
              maxWidth: '520px',
              marginBottom: '36px',
            }}
          >
            {shortDesc}
          </p>

          {/* Divider */}
          <div
            style={{
              width: '60px',
              height: '2px',
              borderRadius: '1px',
              background: `linear-gradient(90deg, transparent, ${colors.glow}60, transparent)`,
              marginBottom: '36px',
            }}
          />

          {/* Meta Info Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              marginBottom: '40px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AppIcon className="ri-calendar-check-line" style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)' }} />
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>{badge.earnedDate}</span>
            </div>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AppIcon className="ri-price-tag-3-line" style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)' }} />
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>{badge.category}</span>
            </div>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AppIcon className="ri-shield-check-line" style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)' }} />
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>Verified</span>
            </div>
          </div>

          {/* User Card */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '16px 24px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              marginBottom: '48px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #1a1a2e 0%, #252545 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '15px',
                fontWeight: 700,
                color: '#ffffff',
              }}
            >
              {userName.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </div>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', lineHeight: 1.3 }}>{userName}</p>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{userRole}</p>
            </div>
          </div>

          {/* Footer with KBC */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: 'auto',
              padding: '12px 24px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #1a1a2e 0%, #252545 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#ffffff', letterSpacing: '0.3px' }}>KBC</span>
            </div>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Knowledge &amp; Business Centre
              </p>
              <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '1px' }}>
                kbc.co.uk/apprenticeships
              </p>
            </div>
          </div>
        </div>

        {/* Corner accents */}
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            width: '40px',
            height: '40px',
            borderLeft: `1px solid ${colors.glow}20`,
            borderTop: `1px solid ${colors.glow}20`,
            borderTopLeftRadius: '12px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '40px',
            height: '40px',
            borderRight: `1px solid ${colors.glow}20`,
            borderTop: `1px solid ${colors.glow}20`,
            borderTopRightRadius: '12px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            width: '40px',
            height: '40px',
            borderLeft: `1px solid ${colors.glow}20`,
            borderBottom: `1px solid ${colors.glow}20`,
            borderBottomLeftRadius: '12px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            width: '40px',
            height: '40px',
            borderRight: `1px solid ${colors.glow}20`,
            borderBottom: `1px solid ${colors.glow}20`,
            borderBottomRightRadius: '12px',
          }}
        />

        {/* Pulse animation style */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.2); }
          }
        `}</style>
      </div>
    );
  }
);

BadgeShareCard.displayName = 'BadgeShareCard';

export default BadgeShareCard;