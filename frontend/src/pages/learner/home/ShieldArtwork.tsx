import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ReferenceIcon } from './ReferenceIcon';
import styles from './studentHome.module.css';

// Contours measured from approved-reference.png, normalised to each panel's box.
// The same outline paints each panel and clips its interactive hit area.
const upperPanel = 'M48 106 C330 100 642 43 882 4 C945 -7 996 38 996 114 V902 Q996 996 902 996 H94 Q4 996 4 906 V160 Q4 110 48 106Z';
const lowerPanel = 'M100 4 H900 Q996 4 996 100 V875 Q996 955 910 966 C800 974 660 998 550 994 C166 998 4 510 4 114 Q4 4 100 4Z';

function BotanicalBranch() {
  return <g fill="currentColor">
    <path d="M70 286 C39 225 43 175 64 128 C83 82 82 45 76 9 M49 216 Q28 194 12 174 M48 184 Q76 172 97 151 M56 145 Q36 129 19 113 M74 94 Q98 80 110 62 M77 64 Q59 51 47 36"
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M76 43 C58 29 67 12 77 0 C82 17 90 28 76 43Z
      M76 65 C55 65 46 48 45 32 C61 39 73 45 76 65Z
      M78 81 C80 61 96 50 115 48 C107 67 96 79 78 81Z
      M68 112 C47 112 38 95 35 78 C54 84 65 94 68 112Z
      M63 135 C68 112 86 101 108 98 C95 119 82 133 63 135Z
      M55 153 C30 151 20 134 14 112 C36 122 50 132 55 153Z
      M48 181 C57 159 79 150 99 149 C85 169 71 180 48 181Z
      M49 215 C26 210 12 194 8 174 C29 182 43 195 49 215Z
      M52 233 C56 212 75 197 93 192 C84 214 73 228 52 233Z
      M62 262 C43 259 28 246 23 227 C43 232 57 246 62 262Z"/>
    <g transform="translate(38 93)">
      <path d="M0 0 C-14 -9 -13 -22 -8 -30 C2 -22 5 -11 0 0Z M0 0 C-3 -17 8 -25 18 -25 C20 -13 11 -3 0 0Z M0 0 C10 -11 24 -9 29 -2 C20 8 9 10 0 0Z M0 0 C15 5 18 17 14 25 C2 22 -3 12 0 0Z M0 0 C-1 15 -12 22 -21 19 C-21 7 -11 0 0 0Z"/>
      <circle r="4"/>
    </g>
  </g>;
}

export function ShieldCrest() {
  return <>
    <svg className={styles.crestFoliage} viewBox="0 0 220 180" aria-hidden="true" focusable="false">
      <g transform="translate(13 12) rotate(-28 60 80) scale(.65 .56)"><BotanicalBranch/></g>
      <g transform="translate(220 0) scale(-1 1)"><g transform="translate(13 12) rotate(-28 60 80) scale(.65 .56)"><BotanicalBranch/></g></g>
    </svg>
    <ReferenceIcon name="crown" className={styles.crown}/>
  </>;
}

export function ShieldAction({ index, href, label, children }: {
  index: number; href: string; label: string; children: ReactNode;
}) {
  const id = useId();
  const clipId = `${id}-outline`;
  const gradientId = `${id}-ivory`;
  const outline = index < 2 ? upperPanel : lowerPanel;
  const mirror = index % 2 === 1 ? 'translate(1000 0) scale(-1 1)' : undefined;

  return <Link to={href} aria-label={label}
    className={`${styles.shieldAction} ${styles[`quadrant${index}`]}`}
    style={{ clipPath: `url(#${clipId})` }}>
    <svg className={styles.actionSurface} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId} clipPathUnits="objectBoundingBox">
          <path d={outline} transform={`scale(.001) ${mirror ?? ''}`}/>
        </clipPath>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fffdfb"/><stop offset="1" stopColor="#f0ece7"/>
        </linearGradient>
      </defs>
      <g transform={mirror}>
        <path className={styles.panelFill} d={outline} fill={`url(#${gradientId})`}/>
        <g className={styles.panelFoliage} transform={index < 2 ? 'translate(595 0) scale(3.25 3.5)' : 'translate(600 490) scale(3.2 1.85)'}>
          <BotanicalBranch/>
        </g>
        <path className={styles.panelBorder} d={outline} fill="none" vectorEffect="non-scaling-stroke"/>
      </g>
    </svg>
    {children}
  </Link>;
}
