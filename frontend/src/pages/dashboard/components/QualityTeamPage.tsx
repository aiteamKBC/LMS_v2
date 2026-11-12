import { useMemo, useState } from "react";
import { QUALITY_TEAM } from "@/mocks/team";
import { RAG_LEVELS } from "@/pages/dashboard/constants";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { RagLevel, TeamMember } from "@/pages/dashboard/types";
import { initials } from "@/pages/dashboard/utils";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const barTone = (member: TeamMember) => {
  const load = member.capacity === 0 ? 0 : Math.round((member.caseload / member.capacity) * 100);
  if (load >= 95) return "bg-red-500";
  if (load >= 80) return "bg-amber-500";
  return "bg-emerald-500";
};

export default function QualityTeamPage({ onToast }: { onToast: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [rag, setRag] = useState<"all" | RagLevel>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invited, setInvited] = useState<string[]>([]);

  const members = useMemo(
    () =>
      QUALITY_TEAM.filter((member) => {
        const matchQuery =
          query.trim() === "" ||
          member.name.toLowerCase().includes(query.trim().toLowerCase()) ||
          member.role.toLowerCase().includes(query.trim().toLowerCase());
        const matchRag = rag === "all" || member.rag === rag;
        return matchQuery && matchRag;
      }),
    [query, rag],
  );

  const summary = useMemo(() => {
    const reviews = QUALITY_TEAM.reduce((sum, member) => sum + member.reviews, 0);
    const approval = Math.round(QUALITY_TEAM.reduce((sum, member) => sum + member.approvalRate, 0) / QUALITY_TEAM.length);
    const rework = Math.round(QUALITY_TEAM.reduce((sum, member) => sum + member.reworkRate, 0) / QUALITY_TEAM.length);
    const caseload = QUALITY_TEAM.reduce((sum, member) => sum + member.caseload, 0);
    return { reviews, approval, rework, caseload };
  }, []);

  const sendInvite = () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      onToast("Enter a valid work email to send an invitation.");
      return;
    }
    setInvited((prev) => [...prev, email]);
    setInviteEmail("");
    setInviteOpen(false);
    onToast(`Invitation queued for ${email}`);
  };

  const cards = [
    { label: "Active reviewers", value: String(QUALITY_TEAM.length), hint: "quality team on shift this week", icon: "ri-team-line", tile: "bg-primary-100 text-primary-700" },
    { label: "Avg approval rate", value: `${summary.approval}%`, hint: "across every reviewer", icon: "ri-check-double-line", tile: "bg-emerald-100 text-emerald-700" },
    { label: "Avg rework rate", value: `${summary.rework}%`, hint: "decisions returned to reviewers", icon: "ri-loop-left-line", tile: "bg-amber-100 text-amber-700" },
    { label: "Open caseload", value: String(summary.caseload), hint: `${summary.reviews} reviews handled in total`, icon: "ri-stack-line", tile: "bg-accent-100 text-accent-700" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Management</p>
          <h2 className="mt-1 font-heading text-[19px] font-semibold leading-tight text-foreground-950">Quality team</h2>
          <p className="mt-1 text-[12px] text-foreground-500">Reviewer performance, capacity and RAG ratings across the quality function.</p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen((prev) => !prev)}
          className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-[12px] font-semibold text-background-50 transition-colors hover:bg-primary-600"
        >
          <i className="ri-user-add-line text-[15px]" aria-hidden />
          Invite reviewer
        </button>
      </header>

      {inviteOpen ? (
        <div className="qa-rise rounded-lg border border-primary-200 bg-primary-50 p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="invite-email" className="text-[11px] font-semibold text-primary-800">
                Work email
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="reviewer@learnqa.co.uk"
                className="mt-1 w-full rounded-md border border-primary-200 bg-background-50 px-2.5 py-2 text-[12.5px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
              />
            </div>
            <button
              type="button"
              onClick={sendInvite}
              className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-600 px-3 py-2 text-[12px] font-semibold text-background-50 hover:bg-primary-700"
            >
              <i className="ri-send-plane-line text-[14px]" aria-hidden />
              Send invite
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="cursor-pointer whitespace-nowrap rounded-md border border-primary-200 px-3 py-2 text-[12px] font-medium text-primary-800 hover:bg-primary-100"
            >
              Cancel
            </button>
          </div>
          {invited.length > 0 ? (
            <p className="mt-2 text-[11px] text-primary-700">Pending invitations: {invited.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-lg border border-background-200 bg-background-50 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-500">{card.label}</p>
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-md ${card.tile}`}>
                <i className={`${card.icon} text-[15px]`} aria-hidden />
              </span>
            </div>
            <p className="mt-1.5 font-heading text-[26px] font-semibold leading-none tabular-nums text-foreground-950">{card.value}</p>
            <p className="mt-2 truncate text-[10.5px] text-foreground-500">{card.hint}</p>
          </article>
        ))}
      </div>

      <section className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex flex-wrap items-center gap-2 border-b border-background-200 p-3">
          <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
            <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reviewer or role"
              className="w-full rounded-md border border-background-200 bg-background-50 py-1.5 pl-8 pr-2.5 text-[12px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
            />
          </div>
          <div className="flex items-center gap-1 rounded-full border border-background-200 bg-background-100 px-1 py-1">
            {(["all", ...RAG_LEVELS] as ("all" | RagLevel)[]).map((level) => {
              const isActive = rag === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setRag(level)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    isActive ? "bg-background-50 text-foreground-950 ring-1 ring-background-200" : "text-foreground-500 hover:text-foreground-800",
                  )}
                  aria-pressed={isActive}
                >
                  {level === "all" ? "All ratings" : level}
                </button>
              );
            })}
          </div>
          <span className="ml-auto text-[11px] text-foreground-500">{members.length} of {QUALITY_TEAM.length} reviewers</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-background-200 bg-background-100/70 text-[10px] uppercase tracking-[0.08em] text-foreground-500">
                <th className="px-4 py-2.5 font-semibold">Reviewer</th>
                <th className="px-3 py-2.5 font-semibold">Caseload</th>
                <th className="px-3 py-2.5 font-semibold">Approval</th>
                <th className="px-3 py-2.5 font-semibold">Rework</th>
                <th className="px-3 py-2.5 font-semibold">Turnaround</th>
                <th className="px-3 py-2.5 font-semibold">Reviews</th>
                <th className="px-4 py-2.5 font-semibold">Rating</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <i className="ri-team-line text-[24px] text-foreground-300" aria-hidden />
                    <p className="mt-1 text-[12px] font-medium text-foreground-600">No reviewers match that filter</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setRag("all");
                      }}
                      className="mt-2 cursor-pointer rounded-md border border-background-300 px-2.5 py-1 text-[11px] font-medium text-foreground-700 hover:bg-background-100"
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              ) : (
                members.map((member) => {
                  const load = member.capacity === 0 ? 0 : Math.round((member.caseload / member.capacity) * 100);
                  return (
                    <tr key={member.id} className="border-b border-background-100 last:border-0 hover:bg-background-100/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-8 flex-none place-items-center rounded-full bg-secondary-100 text-[11px] font-semibold text-secondary-900">
                            {initials(member.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12.5px] font-semibold text-foreground-900">{member.name}</p>
                            <p className="text-[11px] text-foreground-500">{member.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="w-[128px]">
                          <div className="flex items-center justify-between text-[10.5px] text-foreground-500">
                            <span className="tabular-nums text-foreground-800">{member.caseload}/{member.capacity}</span>
                            <span>{load}%</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                            <div className={`h-full rounded-full ${barTone(member)}`} style={{ width: `${Math.min(100, load)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[12px] font-semibold tabular-nums text-foreground-800">{member.approvalRate}%</td>
                      <td className="px-3 py-3 text-[12px] tabular-nums text-foreground-600">{member.reworkRate}%</td>
                      <td className="px-3 py-3 text-[12px] text-foreground-600">{member.turnaround}</td>
                      <td className="px-3 py-3 text-[12px] tabular-nums text-foreground-600">{member.reviews}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={member.rag} size="sm" />
                        <p className="mt-1 max-w-[190px] truncate text-[10.5px] text-foreground-500" title={member.focus}>
                          {member.focus}
                        </p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
