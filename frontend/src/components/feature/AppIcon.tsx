import type { SVGProps } from 'react';
import {
  Activity,
  AlarmClock,
  AlertCircle,
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bold,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarCheck,
  CalendarOff,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CirclePlus,
  CircleX,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Cloud,
  Code2,
  Compass,
  Copy,
  Database,
  Download,
  Ellipsis,
  Edit3,
  Eye,
  ExternalLink,
  File,
  FileArchive,
  FileBarChart,
  FileCheck,
  FileEdit,
  FileSearch,
  FileSignature,
  FileText,
  Flag,
  Folder,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Gift,
  GitBranch,
  GraduationCap,
  HandHeart,
  Headphones,
  Heart,
  HeartPulse,
  Highlighter,
  History,
  Hammer,
  ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LayoutList,
  Lightbulb,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Lock,
  LockKeyhole,
  LogOut,
  Mail,
  Map,
  Maximize2,
  Megaphone,
  MessageCircle,
  Mic,
  Minimize2,
  Minus,
  MoreHorizontal,
  Palette,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Play,
  Plus,
  Plug,
  Power,
  Presentation,
  Redo2,
  RefreshCw,
  RemoveFormatting,
  RotateCcw,
  Save,
  Search,
  SeparatorHorizontal,
  Send,
  Share2,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Strikethrough,
  Tag,
  ThumbsUp,
  Ticket,
  Timer,
  Trash2,
  Trophy,
  Underline,
  Undo2,
  Upload,
  User,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Video,
  WandSparkles,
  Workflow,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface AppIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Existing icon-font class or a compatible dynamic class expression. */
  name?: string;
  size?: number | string;
  title?: string;
}

function resolveIcon(name: string): LucideIcon {
  const key = name.replace(/^ri-/, '').toLowerCase();

  if (/loader|loading/.test(key)) return Loader2;
  // These three sit above the generic branches deliberately. Further down,
  // `/search/` claims anything containing "search" and `/add/` claims anything
  // containing "add", which shadowed the specific branches meant for these
  // names — so `ri-file-search-*` rendered a bare magnifier (the `file-search`
  // branch below is unreachable), `ri-user-add-*` a bare plus, and
  // `ri-megaphone-*` a telephone, because /phone/ matches inside "megaphone".
  // All three are used across the workspace switcher, the audit workspace, the
  // learner clubs feed and the enrolment console.
  if (/file-search/.test(key)) return FileSearch;
  if (/user-add|user-received/.test(key)) return UserPlus;
  if (/megaphone/.test(key)) return Megaphone;
  // Sign-out sits in the header and on the access-required screen; without
  // this it fell through every branch below and rendered a bare circle.
  if (/logout|log-out|sign-out|signout/.test(key)) return LogOut;
  if (/dashboard|layout/.test(key)) return LayoutDashboard;
  if (/home/.test(key)) return LayoutDashboard;
  // High-frequency workspace actions should never fall back to a generic circle.
  if (/task|todo|to-do/.test(key)) return ClipboardList;
  if (/notification|notification-3|bell/.test(key)) return Bell;
  if (/file-list|list-3/.test(key)) return LayoutList;
  if (/file-chart|bar-chart-box/.test(key)) return FileBarChart;
  if (/chat-1|chat|message|feedback|comment/.test(key)) return MessageCircle;
  if (/programme-design/.test(key)) return Presentation;
  if (/curriculum-builder/.test(key)) return Workflow;
  if (/assessment-design/.test(key)) return ClipboardCheck;
  if (/delivery-planning/.test(key)) return CalendarDays;
  if (/quality.*publish/.test(key)) return ShieldCheck;
  if (/node-tree|network|mind-map/.test(key)) return GitBranch;
  if (/hammer|build|construction/.test(key)) return Hammer;
  if (/arrow-left-s/.test(key)) return ChevronLeft;
  if (/arrow-right-s/.test(key)) return ChevronRight;
  if (/arrow-up-s/.test(key)) return ChevronUp;
  if (/arrow-down-s/.test(key)) return ChevronDown;
  // The rich-text toolbar (RichTextEditor.tsx) names most of its buttons with
  // ri-* tokens that have no other branch below, so they all fell through to
  // the bare Circle fallback -- a whole toolbar of identical unlabelled dots.
  if (/undo/.test(key)) return Undo2;
  if (/redo|go-forward/.test(key)) return Redo2;
  if (/^bold$/.test(key)) return Bold;
  if (/^italic$/.test(key)) return Italic;
  if (/underline/.test(key)) return Underline;
  if (/strikethrough|strike-through/.test(key)) return Strikethrough;
  if (/font-color|text-color/.test(key)) return Palette;
  if (/mark-pen|highlight/.test(key)) return Highlighter;
  if (/image/.test(key)) return ImageIcon;
  if (/separator|divider/.test(key)) return SeparatorHorizontal;
  if (/align-left/.test(key)) return AlignLeft;
  if (/align-center/.test(key)) return AlignCenter;
  if (/align-right/.test(key)) return AlignRight;
  if (/list-ordered|numbered/.test(key)) return ListOrdered;
  if (/list-unordered|bullet/.test(key)) return List;
  if (/indent-increase/.test(key)) return IndentIncrease;
  if (/indent-decrease|outdent/.test(key)) return IndentDecrease;
  if (/format-clear|clear-formatting/.test(key)) return RemoveFormatting;
  if (/fullscreen-exit/.test(key)) return Minimize2;
  if (/fullscreen/.test(key)) return Maximize2;
  if (/arrow-go-back|go-back/.test(key)) return RotateCcw;
  if (/arrow-left/.test(key)) return ArrowLeft;
  if (/arrow-right-up/.test(key)) return ArrowUpRight;
  if (/arrow-right/.test(key)) return ArrowRight;
  if (/arrow-up/.test(key)) return ArrowUp;
  if (/arrow-down/.test(key)) return ArrowDown;
  if (/close-circle|error-circle/.test(key)) return CircleX;
  if (/close/.test(key)) return X;
  if (/add-circle/.test(key)) return CirclePlus;
  if (/add/.test(key)) return Plus;
  if (/subtract|minus/.test(key)) return Minus;
  if (/checkbox-blank|radio-button/.test(key)) return Circle;
  if (/checkbox-multiple/.test(key)) return ListChecks;
  if (/checkbox-circle|checkbox/.test(key)) return CircleCheck;
  if (/check-double/.test(key)) return CheckCheck;
  if (/check/.test(key)) return Check;
  if (/search|find/.test(key)) return Search;
  if (/filter/.test(key)) return Settings2;
  if (/refresh|restart|reset/.test(key)) return RefreshCw;
  if (/history|audit/.test(key)) return History;
  if (/more|ellipsis/.test(key)) return MoreHorizontal;
  if (/menu/.test(key)) return MoreHorizontal;
  if (/home/.test(key)) return LayoutDashboard;
  if (/user-star/.test(key)) return UserCheck;
  if (/user-settings|user-cog/.test(key)) return UserCog;
  if (/user-add|user-received/.test(key)) return UserPlus;
  if (/user|profile/.test(key)) return User;
  if (/group|team|organization|organisation|cohort|apprentice|learner/.test(key)) return Users;
  if (/mail/.test(key)) return Mail;
  if (/send/.test(key)) return Send;
  if (/share/.test(key)) return Share2;
  if (/attachment/.test(key)) return Paperclip;
  if (/phone|contact/.test(key)) return Phone;
  if (/video|live|vidicon/.test(key)) return Video;
  if (/mic|voice/.test(key)) return Mic;
  if (/calendar-check|calendar-todo|calendar-close/.test(key)) return CalendarCheck;
  if (/calendar|timetable|schedule|event/.test(key)) return CalendarDays;
  if (/time|timer|clock|otjh|hours/.test(key)) return Timer;
  if (/file-search|search-eye/.test(key)) return FileSearch;
  if (/file-sign/.test(key)) return FileSignature;
  if (/file-check/.test(key)) return FileCheck;
  if (/file-edit|edit/.test(key)) return FileEdit;
  if (/file-upload|upload/.test(key)) return Upload;
  if (/file-copy|copy/.test(key)) return Copy;
  if (/file|document|report|record|policy|form|pdf|word|excel/.test(key)) return FileText;
  if (/folder-add/.test(key)) return FolderPlus;
  if (/folder-upload|folder-open/.test(key)) return FolderOpen;
  if (/folder-close/.test(key)) return FolderArchive;
  if (/folder|storage/.test(key)) return Folder;
  if (/book|knowledge|reading|curriculum|programme|module/.test(key)) return BookOpen;
  if (/questionnaire|question|quiz|assessment/.test(key)) return ClipboardList;
  if (/presentation|teaching/.test(key)) return Presentation;
  if (/learning-journey|compass/.test(key)) return Compass;
  if (/road-map|map|route/.test(key)) return Map;
  if (/flag|gateway|pipeline/.test(key)) return Flag;
  if (/bar-chart|line-chart|chart|progress|analytics|insight|trend/.test(key)) return BarChart3;
  if (/pie-chart/.test(key)) return BarChart3;
  if (/stack/.test(key)) return Layers3;
  if (/draft/.test(key)) return FileEdit;
  if (/database|data/.test(key)) return Database;
  if (/code|xml/.test(key)) return Code2;
  if (/link/.test(key)) return Link;
  if (/branch|version/.test(key)) return GitBranch;
  if (/building|employer|tenant|workplace/.test(key)) return Building2;
  if (/briefcase|portfolio/.test(key)) return Briefcase;
  if (/shield-check|shield-keyhole/.test(key)) return ShieldCheck;
  if (/shield|safeguard|compliance|secure/.test(key)) return Shield;
  if (/lock|door-lock/.test(key)) return LockKeyhole;
  if (/key|permission|access/.test(key)) return KeyRound;
  if (/settings|tools|automation|config/.test(key)) return Settings2;
  if (/plug|integration/.test(key)) return Plug;
  if (/robot|ai/.test(key)) return Bot;
  if (/sparkling|sparkle/.test(key)) return Sparkles;
  if (/wand/.test(key)) return WandSparkles;
  if (/lightbulb|idea/.test(key)) return Lightbulb;
  if (/heart-pulse|wellbeing|welfare/.test(key)) return HeartPulse;
  if (/hand-heart/.test(key)) return HandHeart;
  if (/heart/.test(key)) return Heart;
  if (/trophy|award|medal|achievement/.test(key)) return Trophy;
  if (/star/.test(key)) return Star;
  if (/gift|voucher|coupon|points/.test(key)) return Gift;
  if (/shopping|shop/.test(key)) return ShoppingBag;
  if (/thumb|recognition/.test(key)) return ThumbsUp;
  if (/tag|category/.test(key)) return Tag;
  if (/ticket/.test(key)) return Ticket;
  if (/money|pound|funding|payment|budget/.test(key)) return CircleDollarSign;
  if (/bill|receipt|invoice/.test(key)) return FileText;
  if (/download/.test(key)) return Download;
  if (/save/.test(key)) return Save;
  if (/delete|trash|remove/.test(key)) return Trash2;
  if (/play/.test(key)) return Play;
  if (/power|shut-down|forbid/.test(key)) return Power;
  if (/alarm|warning|alert|risk|error|concern|escalat/.test(key)) return AlertTriangle;
  if (/info|information/.test(key)) return Info;
  if (/eye|view/.test(key)) return Eye;
  if (/pencil|edit/.test(key)) return Pencil;
  if (/group|team|organization|organisation|cohort|learner/.test(key)) return Users;
  if (/download/.test(key)) return Download;
  if (/archive/.test(key)) return FolderOpen;
  if (/external/.test(key)) return ExternalLink;
  if (/pin/.test(key)) return Pin;
  if (/headphone|podcast/.test(key)) return Headphones;
  if (/cloud/.test(key)) return Cloud;
  if (/graduation|education/.test(key)) return GraduationCap;
  if (/activity|engagement/.test(key)) return Activity;
  if (/workflow/.test(key)) return Workflow;
  if (/zap|flash/.test(key)) return Zap;
  if (/alarm-warning/.test(key)) return AlarmClock;

  return Circle;
}

export function AppIcon({ name, className = '', size = '1em', style, ...props }: AppIconProps) {
  const tokens = className.split(/\s+/).filter(Boolean);
  const legacyName = name || tokens.find(token => token.startsWith('ri-')) || 'ri-circle-line';
  const visualClassName = tokens.filter(token => !token.startsWith('ri-')).join(' ');
  const Icon = resolveIcon(legacyName);
  const isFilled = legacyName.includes('-fill');

  return (
    <Icon
      {...props}
      aria-hidden={props['aria-label'] ? undefined : true}
      className={visualClassName ? `app-icon ${visualClassName}` : 'app-icon'}
      width={size}
      height={size}
      strokeWidth={2.2}
      fill={isFilled ? 'currentColor' : 'none'}
      style={{ verticalAlign: 'middle', ...style }}
    />
  );
}
