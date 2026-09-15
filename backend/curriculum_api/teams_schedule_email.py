"""Render a learner's complete schedule. Pure formatting; no Django, DB or mail."""
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

from .teams_calendar_checks import safe_teams_join_url, utc_datetime

TEMPLATE = Path(__file__).with_name('templates') / 'teams_schedule_email.html'
DAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec')


def date_label(value):
    return f'{DAYS[value.weekday()]}, {value.day:02} {MONTHS[value.month - 1]} {value.year}'


def clock_label(value):
    return f'{value.hour % 12 or 12:02}:{value.minute:02} {"AM" if value.hour < 12 else "PM"}'


def render_schedule_email(title, occurrences, time_zone):
    """Use verified occurrence instants and each occurrence's own join link."""
    zone = ZoneInfo(time_zone)
    if not title or not 1 <= len(occurrences) <= 52:
        raise ValueError('A module title and 1–52 verified sessions are required.')
    sessions = sorted(occurrences, key=lambda row: utc_datetime(row['scheduled_start']))
    numbers, links, rows, text_rows = set(), [], [], []
    previous_end = None
    for row in sessions:
        start = utc_datetime(row['scheduled_start']).astimezone(zone)
        end = utc_datetime(row['scheduled_end']).astimezone(zone)
        number = int(row['session_number'])
        link = str(row.get('join_url') or '')
        if (number < 1 or number in numbers or utc_datetime(end) <= utc_datetime(start) or not safe_teams_join_url(link)
                or (previous_end and utc_datetime(start) < previous_end)):
            raise ValueError('Session dates, numbering or Teams links could not be verified.')
        numbers.add(number)
        previous_end = utc_datetime(end)
        if link not in links:
            links.append(link)
        minutes = int((utc_datetime(end) - utc_datetime(start)).total_seconds() / 60)
        if not 15 <= minutes <= 1440:
            raise ValueError('Invalid session duration.')
        overnight = f'<br><span style="font-size:11px;">Ends {escape(date_label(end))}</span>' if start.date() != end.date() else ''
        background = '#ffffff' if len(rows) % 2 == 0 else '#f8f9fc'
        rows.append(f'''<tr bgcolor="{background}">
<td width="54%" style="padding:14px 18px;border-bottom:1px solid #e9edf3;vertical-align:top;"><span style="font-size:10px;color:#7b8192;line-height:16px;">SESSION {number:02}</span><br><strong style="font-size:13px;line-height:21px;color:#243247;">{escape(date_label(start))}</strong></td>
<td width="46%" style="padding:14px 18px;border-bottom:1px solid #e9edf3;vertical-align:top;"><span style="font-size:13px;line-height:21px;font-weight:bold;color:#243247;"><span style="white-space:nowrap;">{clock_label(start)}</span> &ndash; <span style="white-space:nowrap;">{clock_label(end)}</span></span>{overnight}<br><span style="font-size:11px;line-height:18px;color:#7b8192;">{minutes} min</span>__ROW_LINK_{number}__</td></tr>''')
        text_rows.append(f'Session {number}: {date_label(start)}, {clock_label(start)} – {date_label(end)}, {clock_label(end)} ({minutes} min)\n{link}')
    multiple = len(links) > 1
    for index, row in enumerate(sessions):
        link = escape(row['join_url'], quote=True)
        row_link = f'<br><a href="{link}" style="font-size:12px;line-height:24px;color:#5b21b6;">Join this session</a>' if multiple else ''
        rows[index] = rows[index].replace(f'__ROW_LINK_{int(row["session_number"])}__', row_link)
    single_link = escape(links[0], quote=True)
    link_content = ('<p style="margin:0;font-size:13px;line-height:22px;color:#655575;">Your schedule uses more than one Teams link. Use <strong>Join this session</strong> beside the session you are attending.</p>' if multiple else f'''
<p style="margin:0 0 18px;font-size:13px;line-height:21px;color:#655575;">Use the same link for all {len(sessions)} sessions listed below.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#5b21b6" style="background-color:#5b21b6;border-radius:6px;text-align:center;mso-padding-alt:14px 26px;"><a href="{single_link}" style="display:inline-block;padding:14px 26px;border:1px solid #5b21b6;border-radius:6px;font-size:14px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;">Join your Teams session &rarr;</a></td></tr></table>
<p style="margin:15px 0 0;font-size:11px;line-height:18px;color:#776b84;">Button not opening? Copy the meeting link:</p><p style="margin:3px 0 0;font-size:11px;line-height:18px;word-break:break-all;overflow-wrap:anywhere;"><a href="{single_link}" style="color:#5b21b6;">{single_link}</a></p>''')
    values = {'TITLE': escape(title), 'COUNT': str(len(sessions)), 'ZONE': escape(time_zone),
              'ROWS': ''.join(rows), 'LINK_CONTENT': link_content}
    html = TEMPLATE.read_text(encoding='utf-8')
    # Replace template tokens in one pass, so user text cannot introduce tokens.
    import re
    html = re.sub(r'\[\[([A-Z_]+)\]\]', lambda match: values[match[1]], html)
    subject = ' '.join(str(title).split())[:180] + ' — your session schedule'
    text = f'{title}\nYour session schedule — {time_zone}\n\n' + '\n\n'.join(text_rows)
    return subject, html, text
