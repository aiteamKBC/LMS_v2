import { useState, useRef, useEffect } from 'react';

interface EmojiPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  position: { top: number; left: number };
}

const emojiCategories = [
  {
    name: 'Smileys',
    icon: 'ri-emotion-line',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'
    ],
  },
  {
    name: 'Gestures',
    icon: 'ri-hand-heart-line',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','🫵','🫱','🫲','🫳','🫴','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','🧑‍⚕️','🧑‍🎓','🧑‍🏫','🧑‍⚖️','🧑‍🌾','🧑‍🍳','🧑‍🔧','🧑‍🏭','🧑‍💼','🧑‍🔬','🧑‍💻','🧑‍🎤','🧑‍🎨','🧑‍✈️','🧑‍🚀','🧑‍🚒','🧜','🧚','🧛','🧜‍♀️','🧝','🧞','🧟','🧌','🧑‍🦰','🧑‍🦱','🧑‍🦳','🧑‍🦲','🧑‍🦼','🧑‍🦽','🧑‍🦯','🧘'
    ],
  },
  {
    name: 'Animals',
    icon: 'ri-bear-smile-line',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'
    ],
  },
  {
    name: 'Food',
    icon: 'ri-restaurant-line',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🍍','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'
    ],
  },
  {
    name: 'Travel',
    icon: 'ri-plane-line',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️','🛤️','🛣️','🗾','🎑','🏞️','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙️','🌃','🌌','🌉','🌁'
    ],
  },
  {
    name: 'Objects',
    icon: 'ri-lightbulb-line',
    emojis: [
      '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🧰','🔧','🪛','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🧱','⛓️','🧲','🔫','💣','🧱','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','💎','🔔','🔕','📣','📢','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','💨','🕳️','💦','💨','🕯️','💫','⭐','🌟','✨','💥','🔥','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤'
    ],
  },
  {
    name: 'Symbols',
    icon: 'ri-heart-3-line',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📳','📴','💹','❇️','✳️','❎','✅','🅰️','🅱️','🆎','🅾️','🆑','🅾️','🆘','🆚','🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑','🈸','🈴','🈳','㊗️','㊙️','🈺','🈵','🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜','◼️','◻️','◾','◽','▪️','▫️','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','🔳','🔲','💯','💢','♠️','♥️','♦️','♣️','🃏','🀄','🎴','🎭','🎨'
    ],
  },
];

export default function EmojiPicker({ isOpen, onClose, onEmojiSelect, position }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Animate in
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      setIsExiting(false);
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, 200);
      setTimeout(() => searchInputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
    }, 180);
  };

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    handleClose();
  };

  // Filtered emojis
  const filteredEmojis = searchQuery.trim()
    ? emojiCategories
        .flatMap(c => c.emojis)
        .filter(e => e.includes(searchQuery.trim()))
    : emojiCategories[activeCategory].emojis;

  if (!isOpen) return null;

  const pickerTop = Math.min(position.top, window.innerHeight - 420);
  const pickerLeft = Math.max(16, Math.min(position.left, window.innerWidth - 340));

  return (
    <div
      ref={pickerRef}
      className={`fixed z-[200] bg-background-50 rounded-2xl shadow-2xl border border-background-200 overflow-hidden flex flex-col ${
        isExiting ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0'
      } ${isAnimating ? 'opacity-0 scale-95 translate-y-2' : ''}`}
      style={{
        top: pickerTop,
        left: pickerLeft,
        width: 320,
        height: 400,
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Header with search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-background-200/70 shrink-0">
        <div className="w-4 h-4 flex items-center justify-center text-foreground-400">
          <i className="ri-search-line text-xs"></i>
        </div>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search emojis..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-foreground-800 outline-none placeholder:text-foreground-400"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="w-5 h-5 flex items-center justify-center text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer"
          >
            <i className="ri-close-line text-xs"></i>
          </button>
        )}
      </div>

      {/* Emoji grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto p-2 custom-scrollbar">
        {!searchQuery && (
          <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide px-1 mb-1 mt-1">
            {emojiCategories[activeCategory].name}
          </p>
        )}
        {searchQuery && (
          <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide px-1 mb-1 mt-1">
            Results
          </p>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {filteredEmojis.map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              onClick={() => handleEmojiClick(emoji)}
              className="w-9 h-9 flex items-center justify-center text-xl hover:bg-background-100 rounded-lg transition-smooth cursor-pointer select-none"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        {filteredEmojis.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-8 h-8 flex items-center justify-center text-foreground-300 mb-2">
              <i className="ri-emotion-unhappy-line text-lg"></i>
            </div>
            <p className="text-xs text-foreground-400">No emojis found</p>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex items-center justify-around px-2 py-2 border-t border-background-200/70 shrink-0 bg-background-50">
        {emojiCategories.map((cat, idx) => (
          <button
            key={cat.name}
            onClick={() => {
              setActiveCategory(idx);
              setSearchQuery('');
            }}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-smooth cursor-pointer ${
              activeCategory === idx && !searchQuery
                ? 'bg-primary-100 text-primary-500'
                : 'text-foreground-400 hover:text-foreground-600 hover:bg-background-100'
            }`}
            title={cat.name}
          >
            <i className={`${cat.icon} text-sm`}></i>
          </button>
        ))}
      </div>
    </div>
  );
}