# Phase 4G.7A — Windows Network Isolation for the Neon HTTP Benchmark

Date: 2026-10-28 (Africa/Cairo)  
Verdict: **READY WITH APPROVAL**

## A. Verdict

The workstation is not isolated for Phase 4G.7 today, so the authenticated HTTP benchmark must remain stopped.

A process-tree boundary can be built with existing Windows capabilities, but it requires an elevated, explicitly approved configuration change. The proposed boundary uses:

1. a temporary unprivileged Windows account dedicated to this benchmark;
2. outbound Windows Defender Firewall rules scoped to that account SID;
3. IPv4 loopback as the only network reachable by that account;
4. only two permitted loopback TCP destination ports;
5. a trusted fixed-destination PostgreSQL TLS relay running outside the restricted account;
6. exact TLS hostname validation plus PostgreSQL branch, endpoint, database and Reader-role verification.

No overlapping firewall `ALLOW` and `BLOCK` rules are used. Microsoft documents that explicit block rules override conflicting allow rules and that Windows Firewall has no administrator-assigned rule ordering. The design therefore blocks the complement of the two allowed loopback ports, leaving those ports unmatched and handled by the existing default outbound allow policy. See [Windows Firewall rule precedence](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules).

The design is ready for an approval-gated implementation and empirical test. It is not yet active or verified, so Phase 4G.7 is still blocked.

## B. Windows Environment

| Item | Observed value |
|---|---|
| OS | Windows 10 Pro for Workstations 22H2, x64 |
| Version / build | `10.0.19045` / `19045` |
| Current account | Standard local account; **not Administrator** |
| Base Filtering Engine | Running, Automatic |
| Windows Defender Firewall service | Running, Automatic |
| Domain / Private / Public profiles | Enabled |
| Effective inbound policy | Block |
| Effective outbound policy | Allow |
| Active network profile | Private, IPv4 Internet; IPv6 reported no traffic |
| Active external adapter | One Ethernet adapter plus IPv4/IPv6 loopback |
| Microsoft Defender AV / real-time protection | Enabled |
| Defender Network Protection | Disabled (`EnableNetworkProtection=0`) |
| Docker / Podman / Sandboxie / Firejail | Not installed |
| WSL | Command surface present; no usable distribution/runtime |
| Windows Sandbox / Hyper-V feature state | Could not be queried without elevation; no runnable Sandbox command found |
| WFP | BFE and diagnostic `netsh wfp` surface present; no existing supported filter-authoring utility found |

The current non-elevated account cannot enumerate `ActiveStore` rules through the NetSecurity CIM provider; both full outbound-rule enumeration and Python-rule lookup returned `Access is denied`. `netsh` and the local firewall registry did permit read-only inspection of relevant local rules.

## C. Actual Executable Paths

| Purpose | Path / identity |
|---|---|
| Global Python | `C:\Python314\python.exe` (Python 3.14.6) |
| Dedicated repository virtual-environment Python | `D:\aiTeam\LMS_v2\backend\.venv\Scripts\python.exe` |
| Django entry point | `D:\aiTeam\LMS_v2\backend\manage.py` |
| Benchmark settings/guard | `backend/config/settings.py`, `backend/config/test_isolation.py` |
| Credential reader | `backend/config/benchmark_credentials.py` |
| Runtime identity verifier | `backend/reports/verify_phase4g2_runtime.py` |
| Proposed Django listen address | `127.0.0.1:8765` |
| Proposed fixed PostgreSQL relay | `127.0.0.1:15432` |

Launching the virtual-environment interpreter and inspecting the live process confirmed that its Windows image path remains the unique repository path above; it is not reported as the global `C:\Python314\python.exe`. Its SHA-256 was recorded during inspection without changing the file. The runtime must re-check the hash immediately before applying rules.

The shared global interpreter must not be used for the benchmark. Rules against it would affect unrelated Python applications.

## D. Current Firewall Behaviour

The current profiles use `BlockInbound,AllowOutbound`. No rule matching the repository virtual-environment Python path or an LMS/Phase4G7A rule name was found through the readable `netsh` policy view.

Three existing rules named `codex_sandbox_offline_*` were found. Registry inspection proved that they are scoped to the separate `CodexSandboxOffline` account SID, not to the current account, the repository Python executable, or a future LMS benchmark account. They also block all loopback TCP, so that account cannot be reused unchanged for the required localhost HTTP plus local database-relay flow. Those Codex rules must not be edited because doing so could affect unrelated tooling.

Windows dynamic keyword/FQDN commands are installed. They are not selected because:

- Defender Network Protection is disabled, while Microsoft's FQDN auto-resolution design requires Network Protection and has documented DNS timing/secure-DNS limitations;
- an FQDN firewall object ultimately represents resolved IP addresses and is not an authenticated Neon branch identity;
- the observed test hostname resolved through a regional CNAME to multiple IPv4 and IPv6 addresses with short TTLs;
- parent/test endpoints can share regional infrastructure.

Microsoft explicitly states that FQDN rules are not secure DNS and are not a replacement for IP controls in every scenario: [Windows Firewall dynamic keywords](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords).

Read-only DNS inspection of the authorised test hostname produced the following rotating regional records during this task. These are observations, not an allowlist:

| Record | Observed value |
|---|---|
| CNAME | `eu-west-2.aws.neon.tech` |
| A | `13.41.250.251`, `35.177.127.187`, `13.43.29.36` |
| AAAA | `2a05:d01c:c65:280c:ad0b:9757:1116:bcab`, `2a05:d01c:c65:281b:bcfb:93a:daab:e0ce`, `2a05:d01c:c65:2824:4bbb:d4f1:a71e:2c1f` |

The currently verified credential uses the direct host `ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech`, not the `-pooler` hostname. The proposed relay therefore permits only that direct hostname and port `5432`; it does not silently switch between pooled and direct hosts. A future endpoint or pooling change invalidates this configuration and requires a new hostname/TLS/identity review.

## E. Isolation Architecture

### Selected model

```text
PowerShell HTTP client (fixed http://127.0.0.1:8765 only)
                         |
                         v
temporary benchmark account
  Django/.venv Python -- TCP 127.0.0.1:15432 only --> fixed PostgreSQL TLS relay
  all child processes        all other TCP/UDP/IP blocked       |
                                                              TLS + fixed SNI
                                                                  |
                                                                  v
                         ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech:5432
```

The firewall scope is the temporary account SID, not a program path. This covers Django, ordinary Python sockets, direct psycopg connections, and child executables started under that account. The account is standard, is not added to Administrators, and receives no credentials for any other Windows account.

The relay is not a generic HTTP, SOCKS, TCP or PostgreSQL proxy. It must:

- bind only `127.0.0.1:15432`;
- have the upstream hostname and port compiled/configured as immutable values;
- reject all destination input from the local client;
- perform PostgreSQL SSL negotiation itself;
- validate the certificate chain and the exact hostname `ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech`;
- expose no management endpoint;
- log no credentials, queries or payload bodies.

The relay runs under the normal workstation account. The benchmark account can reach it, but cannot ask it to connect anywhere else. A raw relay is insufficient because a client could choose a different TLS SNI on the same shared regional IP. TLS must terminate in the fixed relay.

### Why standard program allow/block rules were rejected

A broad program block plus a narrower destination allow is not a valid allowlist on Windows Firewall: the explicit block wins. IP-only rules were also rejected because they cannot identify a Neon branch and would be fragile under DNS rotation. WFP can filter per application/user/connection and supports IPv4 and IPv6, but `netsh wfp` is diagnostic, not a supported filter authoring surface. A new custom WFP manager/callout would add unnecessary code and review risk. Microsoft describes WFP's capabilities and security model here: [About Windows Filtering Platform](https://learn.microsoft.com/en-us/windows/win32/fwp/about-windows-filtering-platform).

## F. Neon Endpoint Protection

The network and database protections are layered:

1. The benchmark account cannot open any non-loopback connection.
2. Only the fixed local relay can open the upstream connection.
3. The relay fixes the upstream hostname and SNI; no client-selected destination is accepted.
4. TLS certificate-chain and exact-hostname validation are mandatory.
5. DNS rotation is handled by the relay resolving the exact hostname per new upstream connection; resolved IPs are not persisted as the security identity.
6. After login, the application must require all of:
   - `current_database() = 'neondb'`;
   - `current_user = 'lms_benchmark_reader'`;
   - `transaction_read_only = 'on'`;
   - `current_setting('neon.branch_id', true) = 'br-orange-shadow-abm8uwwe'`;
   - `current_setting('neon.endpoint_id', true) = 'ep-dawn-block-ab5vob3x'`.
7. The existing Reader grants remain the final database backstop.

PostgreSQL documents that `sslmode=verify-full` verifies both the certificate chain and requested hostname and recommends it for security-sensitive connections: [libpq connection parameters](https://www.postgresql.org/docs/current/libpq-connect.html). The fixed relay must provide equivalent exact-hostname validation; `sslmode=require` alone is insufficient for hostname authentication.

No negative test may connect to the parent or Production. Incorrect-identity rejection is tested by deliberately supplying an incorrect expected branch/endpoint value while still connecting only to the authorised test endpoint, or by a local protocol fake.

## G. Proposed Rules and Enforcement Configuration

### Scope

| Setting | Proposed value |
|---|---|
| Temporary account | `LMSBenchPhase4G7` |
| Account expiry | Three hours after creation |
| Rule group | `LMS Phase4G7A Temporary Isolation` |
| Allowed IPv4 destinations | `127.0.0.1:8765` and `127.0.0.1:15432` only |
| Allowed IPv6 destinations | None |
| Allowed UDP | None |
| Other IP protocols | None available to the standard account; ICMPv4 explicitly blocked |
| Rule store | `PersistentStore`, removed immediately after the run |
| Maximum intended lifetime | One benchmark session; account expiry is a fail-safe, not cleanup |

### Exact elevated application commands — **PROPOSED, NOT EXECUTED**

Run only after explicit approval in an Administrator PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$RuleGroup = 'LMS Phase4G7A Temporary Isolation'
$UserName = 'LMSBenchPhase4G7'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator PowerShell is required.'
}
if (Get-NetFirewallRule -Group $RuleGroup -ErrorAction SilentlyContinue) {
  throw 'Stale Phase4G7A firewall rules already exist; inspect and remove them first.'
}
if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
  throw 'The temporary benchmark account already exists; inspect it before continuing.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 8765,15432 -ErrorAction SilentlyContinue) {
  throw 'A proposed local benchmark port is already occupied.'
}

$Password = Read-Host 'Temporary benchmark-account password' -AsSecureString
New-LocalUser -Name $UserName -Password $Password `
  -Description 'Temporary Phase 4G.7 isolated benchmark account' `
  -AccountExpires (Get-Date).AddHours(3) -UserMayNotChangePassword
$Sid = (Get-LocalUser -Name $UserName).SID.Value
$UserSddl = "O:LSD:(A;;CC;;;$Sid)"

$Common = @{
  Direction='Outbound'; Action='Block'; Enabled='True'; Profile='Any'
  PolicyStore='PersistentStore'; Group=$RuleGroup; LocalUser=$UserSddl
}
New-NetFirewallRule @Common -Name 'LMS-P4G7A-Block-NonLoopback-IPv4' `
  -DisplayName 'LMS Phase4G7A - block non-loopback IPv4' `
  -RemoteAddress '0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255'
New-NetFirewallRule @Common -Name 'LMS-P4G7A-Block-All-IPv6' `
  -DisplayName 'LMS Phase4G7A - block all IPv6' -RemoteAddress '::/0'
New-NetFirewallRule @Common -Name 'LMS-P4G7A-Block-Loopback-UDP' `
  -DisplayName 'LMS Phase4G7A - block loopback UDP' `
  -RemoteAddress '127.0.0.0/8' -Protocol UDP
New-NetFirewallRule @Common -Name 'LMS-P4G7A-Block-Loopback-ICMPv4' `
  -DisplayName 'LMS Phase4G7A - block loopback ICMPv4' `
  -RemoteAddress '127.0.0.0/8' -Protocol ICMPv4
New-NetFirewallRule @Common -Name 'LMS-P4G7A-Block-Other-Loopback-TCP' `
  -DisplayName 'LMS Phase4G7A - block other loopback TCP ports' `
  -RemoteAddress '127.0.0.0/8' -Protocol TCP `
  -RemotePort '1-8764','8766-15431','15433-65535'

if (Get-LocalGroupMember -Group 'Administrators' | Where-Object SID -eq $Sid) {
  throw 'The temporary benchmark account must not be an Administrator.'
}
```

There is deliberately no `ALLOW` rule. The two allowed loopback TCP ports are the complement left unmatched by the block rules. Before use, elevated inspection must confirm that no other explicit block rule applies to those ports for the new SID.

## H. Exact Runtime Commands

The following commands describe the approved run boundary; the fixed TLS relay and secure account launcher must be code-reviewed before use and must not accept a destination or secret on their command lines.

```powershell
# Trusted normal-account process: exact upstream is fixed inside the relay config.
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe `
  -NoProfile -ExecutionPolicy Bypass `
  -File D:\aiTeam\LMS_v2\.runtime\phase4g7a\Start-FixedPgTlsRelay.ps1 `
  -ListenAddress 127.0.0.1 -ListenPort 15432

# Secure launcher prompts for the temporary local-account password, reads the
# Reader URL from Windows Credential Manager in the parent process, injects it
# only into the child environment, and never writes/prints it.
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe `
  -NoProfile -ExecutionPolicy Bypass `
  -File D:\aiTeam\LMS_v2\.runtime\phase4g7a\Start-IsolatedDjango.ps1 `
  -UserName LMSBenchPhase4G7 `
  -Python D:\aiTeam\LMS_v2\backend\.venv\Scripts\python.exe `
  -ManagePy D:\aiTeam\LMS_v2\backend\manage.py `
  -ListenAddress 127.0.0.1 -ListenPort 8765 `
  -DatabaseRelay 127.0.0.1:15432
```

The launcher environment must contain only the existing Reader credential and exact test metadata:

```text
RUN_APP_ON_TEST_BRANCH=true
LMS_TEST_MODE=postgres-read-only
LMS_TEST_POSTGRES_BRANCH_NAME=lms_ideal_test
LMS_TEST_POSTGRES_BRANCH_ID=br-orange-shadow-abm8uwwe
LMS_TEST_POSTGRES_ENDPOINT_ID=ep-dawn-block-ab5vob3x
DJANGO_SETTINGS_MODULE=config.settings
```

It must clear owner/fallback variables and external integration secrets exactly as the existing benchmark bootstrap does. Django starts with `runserver 127.0.0.1:8765 --noreload`; no autoreloader, worker, scheduler or background process is allowed.

The current database guard expects a direct Neon TLS URL. A small benchmark-only relay adapter is therefore required so psycopg connects plaintext only to `127.0.0.1:15432` while the trusted relay owns upstream TLS. This must not weaken the normal `postgres-read-only` mode. It must require an explicit relay flag, exact loopback address/port, and all five post-connect identity checks listed above. This infrastructure change requires review before the elevated firewall application step.

## I. Verification Commands and Expected Results

Inspection or mocked tests do not establish readiness. After approval and application, all of the following must pass with real OS enforcement:

1. **Rule shape and scope**

   ```powershell
   Get-NetFirewallRule -Group 'LMS Phase4G7A Temporary Isolation' |
     Format-Table Name,Enabled,Direction,Action,Profile
   Get-NetFirewallRule -Group 'LMS Phase4G7A Temporary Isolation' |
     Get-NetFirewallAddressFilter | Format-List
   Get-NetFirewallRule -Group 'LMS Phase4G7A Temporary Isolation' |
     Get-NetFirewallPortFilter | Format-List
   Get-NetFirewallRule -Group 'LMS Phase4G7A Temporary Isolation' |
     Get-NetFirewallSecurityFilter | Format-List
   ```

   Expected: exactly five outbound block rules, the new account SID only, the address and port complements above, no wildcard allow rule.

2. **Unrelated application unaffected**

   Start controlled listeners on the workstation's non-loopback IPv4 address and `::1`. The normal account must reach the IPv4 listener; the benchmark account must not. No Internet host is required for this proof.

3. **Localhost path**

   The benchmark account must connect to `127.0.0.1:15432`; the normal-account HTTP client must reach `http://127.0.0.1:8765`. Connections from the benchmark account to adjacent loopback ports must fail.

4. **Non-loopback IPv4 and IPv6 block**

   A minimal socket program using the repository virtual-environment interpreter under the benchmark account must fail against the controlled Ethernet listener and the `::1` listener. Run the same test from a child PowerShell/curl process under that account; it must also fail, proving the SID scope follows child executables.

5. **Direct psycopg restriction**

   Direct psycopg attempts to any non-loopback address must fail before PostgreSQL authentication. Psycopg to the fixed local relay must succeed only with the Reader credential.

6. **TLS and identity**

   The relay must record only a successful exact-hostname TLS validation result, never a credential. The database check must return the exact database, Reader, read-only, branch and endpoint values. Deliberately setting the expected endpoint/branch metadata to a false test value must make the guard close the same authorised test connection and fail startup; it must not contact another endpoint.

7. **DNS/rotation**

   The benchmark account performs no external DNS-dependent connection. The relay re-resolves only the fixed endpoint and validates its certificate on every new upstream TLS connection. An injected wrong hostname in a relay unit/integration test must fail TLS validation while still using only the authorised test endpoint address.

8. **No writes**

   Re-run the Reader privilege/runtime verification and fixture counts. No authenticated HTTP benchmark begins until every network test above passes.

## J. Emergency Rollback

Run from Administrator PowerShell. Stop/disable the restricted account before deleting its rules, so a surviving process cannot gain outbound access during cleanup.

```powershell
$ErrorActionPreference = 'Continue'
$UserName = 'LMSBenchPhase4G7'
$RuleGroup = 'LMS Phase4G7A Temporary Isolation'

Disable-LocalUser -Name $UserName -ErrorAction SilentlyContinue
taskkill.exe /F /T /FI "USERNAME eq $env:COMPUTERNAME\$UserName"
Get-NetFirewallRule -Group $RuleGroup -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule
Remove-LocalUser -Name $UserName -ErrorAction SilentlyContinue
```

Then stop the fixed relay and remove only `D:\aiTeam\LMS_v2\.runtime\phase4g7a`. Do not remove or modify any `codex_sandbox_*` rules. Verify:

```powershell
Get-NetFirewallRule -Group 'LMS Phase4G7A Temporary Isolation' -ErrorAction SilentlyContinue
Get-LocalUser -Name 'LMSBenchPhase4G7' -ErrorAction SilentlyContinue
```

Both commands must return no object. The firewall profile defaults remain unchanged throughout.

## K. Impact on Other Applications

- No default firewall profile action changes.
- No rule targets the normal workstation account, global Python, browsers, Teams, Codex accounts, services or other applications.
- The rule scope is a newly created temporary SID.
- The relay binds loopback only and uses dedicated ports checked for conflicts before startup.
- Account expiry limits damage if normal cleanup is missed, although stale rules/account must still be removed.
- Existing `codex_sandbox_*` rules are preserved.

## L. Security Limitations

- The proposed rules have not been applied or empirically tested; inspection alone is not proof of enforcement.
- Administrator approval is required to create the local account and firewall rules and to perform full ActiveStore inspection.
- The fixed TLS relay and secure cross-account launcher do not yet exist. They must be implemented as benchmark-only infrastructure, reviewed, hash-pinned for the run, and validated before rule application.
- Windows Firewall does not understand Neon branch identity; the relay's exact TLS endpoint plus PostgreSQL identity queries are mandatory.
- A local Administrator can bypass any workstation boundary. The threat model is ordinary benchmark code, Python sockets, psycopg and child processes under the restricted account, not a malicious Administrator/kernel.
- The relay becomes a trusted security component. It must not be a generic proxy and must never accept an upstream destination from the benchmark process.
- The application currently accepts `sslmode=require`; the approved relay path must provide exact hostname validation before Phase 4G.7 proceeds.

## M. Phase 4G.7 Readiness

**Not ready today.** Phase 4G.7 may resume only after all of these gates are satisfied:

1. explicit approval for the temporary account and exact five firewall rules;
2. code review of the fixed TLS relay, secure launcher and benchmark-only relay adapter;
3. elevated preflight confirms no overlapping rule and no port conflict;
4. real OS-enforced IPv4, IPv6, child-process and direct-psycopg negative tests pass;
5. exact TLS, branch, endpoint, database, role and read-only checks pass;
6. cleanup/rollback is tested before the authenticated benchmark begins.

If any gate fails, remove the temporary resources and retain the Phase 4G.7 `BLOCKED` verdict.

## N. Safety Confirmation

- Production was not accessed.
- The parent database/endpoint was not accessed.
- Only the authorised test hostname was resolved; no PostgreSQL benchmark request was run.
- No firewall rule, profile, adapter or system setting was changed.
- No local account was created, changed or deleted.
- No software, Windows feature, driver, WSL distribution or container runtime was installed or enabled.
- No Neon role, permission, branch or endpoint was changed.
- No database write occurred.
- The synthetic fixture and receipt were not modified or cleaned up.
- No Django server or authenticated HTTP benchmark was started.
- No application or frontend production source was changed.
- Existing contributor changes were preserved.
- No commit or push was performed.

Changed by this task: this report only.
