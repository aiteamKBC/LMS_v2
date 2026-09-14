import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { TrainingPlanDashboard, PlanReview } from '@/api/trainingPlanDashboard';
import type { Subject } from '../my-learning/SubjectWorkspace';
import { TrainingPlanDetails } from './TrainingPlanDetails';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const subjects: Subject[] = [{ id:'legacy:10',title:'Marketing',source:'legacy',activities:[1,8,15,22].map((day,index)=>({
  id:`A${index}`,title:`Activity ${index}`,category:'reading',position:index,completed:index<2,schedule:{date:`2026-09-${String(day).padStart(2,'0')}`},
})) },{id:'current:NEW',title:'New module',source:'current',activities:[]}];
const review=(id:string,date:string,status='not-scheduled',source='progress-review'):PlanReview=>({id,eventKey:id,title:'Progress Review',source,sequence:1,status,date,targetDate:date,scheduledDate:null,scheduledTime:null,durationMinutes:60,coachName:'Review coach',invited:false});
const fixture=():TrainingPlanDashboard=>({
  months:{'2026-09':{label:'',topics:['Brand strategy'],planned:18,source:'contract'},'2026-10':{label:'',topics:['Research'],planned:20,source:'contract'}},
  actual:[{month:'2026-09',groupId:'10',hours:7,count:2},{month:'2026-09',groupId:null,hours:4.5,count:1}],actualAvailable:true,
  modules:[{id:'M10',title:'Marketing',description:'Builder description',start_date:'2026-09-01',end_date:'2026-10-31',tutor_name:'Assigned tutor',coach_name:'Assigned coach'},
    {id:'NEW',title:'New module',description:'Just assigned',start_date:null,end_date:null,tutor_name:'',coach_name:''}],
  moduleLinks:{'legacy:10':{id:'M10',title:'Marketing'},'current:NEW':{id:'NEW',title:'New module'}},
  sessions:[
    {id:'attended',moduleId:'M10',title:'Attended session',start:'2026-09-01T10:00:00Z',end:'2026-09-01T11:00:00Z',minutes:60,joinUrl:null,status:'completed',attended:true},
    {id:'missed',moduleId:'M10',title:'Missed session',start:'2026-09-08T10:00:00Z',end:null,minutes:60,joinUrl:null,status:'completed',attended:false},
    {id:'next',moduleId:'M10',title:'Next session',start:'2026-09-15T10:00:00Z',end:null,minutes:45,joinUrl:'https://teams.microsoft.com/l/meetup-join/verified',status:'scheduled',attended:null},
  ],
  reviews:[review('future','2026-09-22'),review('overdue','2026-09-08'),review('done','2026-09-01','completed'),review('booked','2026-09-15','scheduled')],
  coach:{name:'Assigned coach',bookingUrl:'https://outlook.office.com/book/assigned-coach'},contractStatus:'ready',generatedAt:'2026-09-10T08:00:00Z',
});
function Destination(){const route=useLocation();return <output data-testid="destination">{route.pathname}{route.search}{route.hash}</output>;}
function renderBoard(data=fixture(),onRefresh=vi.fn()){
  return render(<MemoryRouter initialEntries={['/plan']}><Routes><Route path="/plan" element={<TrainingPlanDetails data={data} subjects={subjects} kind="commercial" learnerId="125" onRefresh={onRefresh} onRetryContract={onRefresh}/>}/><Route path="*" element={<Destination/>}/></Routes></MemoryRouter>);
}
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(()=>{HTMLElement.prototype.scrollIntoView=vi.fn();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();HTMLElement.prototype.scrollIntoView=originalScrollIntoView;});

describe('Dashboard training plan controls',()=>{
  it('switches between monthly sessions and reviews while retaining all filters',()=>{
    renderBoard();
    fireEvent.change(screen.getByRole('combobox',{name:'Filter monthly sessions'}),{target:{value:'pending'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Focus module'}),{target:{value:'current:NEW'}});
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    expect(screen.getByRole('region',{name:'Programme reviews'})).toBeVisible();
    expect(screen.queryByRole('region',{name:'Monthly study plan'})).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Reviews');
    fireEvent.click(screen.getByRole('tab',{name:'Live Sessions'}));
    expect(screen.getByRole('combobox',{name:'Filter monthly sessions'})).toHaveValue('pending');
    expect(screen.getByRole('combobox',{name:'Focus module'})).toHaveValue('current:NEW');
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-09');
    expect(screen.getByText('Missed session')).toBeVisible();
    expect(screen.queryByRole('region',{name:'Programme reviews'})).not.toBeInTheDocument();
  });

  it('supports keyboard switching between the session and review tabs',()=>{
    renderBoard();
    const sessionsTab=screen.getByRole('tab',{name:'Live Sessions'});
    const reviewsTab=screen.getByRole('tab',{name:'Reviews'});
    sessionsTab.focus();
    fireEvent.keyDown(sessionsTab,{key:'ArrowRight'});
    expect(reviewsTab).toHaveFocus();
    expect(reviewsTab).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(reviewsTab,{key:'Home'});
    expect(sessionsTab).toHaveFocus();
    expect(sessionsTab).toHaveAttribute('aria-selected','true');
  });

  it('synchronises Gantt bars and module names with the overview without changing the month or session filter',()=>{
    renderBoard();
    fireEvent.change(screen.getByLabelText('Focus month'),{target:{value:'2026-12'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Filter monthly sessions'}),{target:{value:'completed'}});
    fireEvent.click(screen.getByRole('button',{name:'Show Marketing overview'}));
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-12');
    expect(screen.getByRole('combobox',{name:'Focus module'})).toHaveValue('legacy:10');
    expect(screen.getByRole('button',{name:'Show Marketing overview'})).toHaveAttribute('aria-pressed','true');
    expect(within(screen.getByRole('region',{name:'Module overview'})).getByRole('heading',{name:'Marketing'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'New module'}));
    expect(within(screen.getByRole('region',{name:'Module overview'})).getByRole('heading',{name:'New module'})).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Focus module'})).toHaveValue('current:NEW');
    expect(screen.getByRole('combobox',{name:'Filter monthly sessions'})).toHaveValue('completed');
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-12');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
  });

  it('keeps module selection when opening and closing the full-screen timeline',()=>{
    renderBoard();
    fireEvent.click(screen.getByRole('button',{name:'Full screen'}));
    fireEvent.click(screen.getByRole('button',{name:'Show New module overview'}));
    expect(within(screen.getByRole('complementary')).getByRole('heading',{name:'New module'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Exit full screen'}));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region',{name:'Module overview'})).getByRole('heading',{name:'New module'})).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Focus module'})).toHaveValue('current:NEW');
  });

  it('restores the selected module plan, timetable, activity breakdown and mapped KSBs from compact summaries',()=>{
    const data=fixture();
    data.modules[0]={...data.modules[0],programme_name:'Marketing Level 4',cohort_name:'October 2026',group_name:'G1',
      total_otjh:140,weeks_number:16,sessions_number:16,session_week_day:'Thursday',session_start_time:'09:00',session_end_time:'11:00',
      coach_name:'Module coach',learning_outcomes:['Plan a campaign','Measure campaign results']};
    data.sessions=[];
    render(<MemoryRouter><TrainingPlanDetails data={data} subjects={[{
      id:'legacy:10',title:'Marketing',source:'legacy',total:345,completed:1,dates:['2026-10-05'],moduleIds:['M10'],sessionTitles:[],
      activityCounts:{reading:67,powerpoint:48,assignment:6,quiz:48,live_session:16,podcast:48,video:112},ksbCodes:['K1','S2','B3'],ksbMappingMissing:false,
    }]} kind="commercial" learnerId="125" initialSubjectId="legacy:10" onRefresh={vi.fn()} onRetryContract={vi.fn()} /></MemoryRouter>);
    const panel=within(screen.getByRole('region',{name:'Module overview'}));
    for(const value of ['140 hours','Thursday · 09:00–11:00','Cohort: October 2026','Group: G1','Marketing Level 4','Module coach','Assigned tutor','1 of 345 activities completed · 344 remaining']) {
      expect(panel.getByText(value)).toBeVisible();
    }
    expect(panel.queryByText('Planned live sessions')).not.toBeInTheDocument();
    expect(panel.queryByText('Next session')).not.toBeInTheDocument();
    expect(panel.getByText('Videos').parentElement).toHaveTextContent('112');
    const ksbToggle=panel.getByText('View 3 mapped KSBs');
    fireEvent.click(ksbToggle);
    expect(ksbToggle.closest('details')).toHaveAttribute('open');
    expect(panel.getByText('S2')).toBeVisible();
    fireEvent.click(panel.getByText('Learning outcomes (2)'));
    expect(panel.getByText('Measure campaign results')).toBeVisible();
  });

  it('shows future programme reviews even when none falls within the selected module',()=>{
    const data=fixture();
    data.reviews=[review('monthly','2026-11-30','not-scheduled','mcr'),review('progress','2027-03-18')];
    renderBoard(data);
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    const panel=within(screen.getByRole('region',{name:'Programme reviews'}));
    expect(panel.getByText('0 of 2 completed · Whole programme')).toBeVisible();
    expect(panel.getAllByRole('link',{name:'Schedule'})).toHaveLength(2);
    expect(panel.queryByText('Your reviews will appear here once planned.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox',{name:'Focus module'}),{target:{value:'current:NEW'}});
    expect(panel.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(panel.getAllByRole('link',{name:'Schedule'})[0]);
    expect(screen.getByTestId('destination')).toHaveTextContent('event=monthly&action=schedule');
  });

  it('offers Attend only for an active booking with a meeting link and keeps completed reviews viewable',()=>{
    const data=fixture();
    data.reviews=[{...review('join','2026-09-15','scheduled'),meetingLink:'https://teams.microsoft.com/l/meetup-join/review',invited:true},
      {...review('finished','2026-09-01','completed'),meetingLink:'https://teams.microsoft.com/l/meetup-join/old'},
      {...review('cancelled','2026-09-02','cancelled'),meetingLink:'https://teams.microsoft.com/l/meetup-join/cancelled'},
      review('pending','2026-09-16','scheduled')];
    renderBoard(data);
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    const panel=within(screen.getByRole('region',{name:'Programme reviews'}));
    expect(panel.getAllByRole('article')).toHaveLength(3);
    expect(panel.getAllByRole('link',{name:'Attend'})).toHaveLength(1);
    expect(panel.getByRole('link',{name:'Attend'})).toHaveAttribute('href','https://teams.microsoft.com/l/meetup-join/review');
    expect(panel.getByRole('link',{name:'Attend'})).toHaveAttribute('target','_blank');
    expect(panel.getByRole('link',{name:'View'})).toHaveAttribute('href','/learner/calendar?kind=commercial&learner=125&event=finished');
    expect(panel.getByText('Meeting link pending')).toBeVisible();
    expect(panel.getByRole('link',{name:'View booking'})).toBeVisible();
  });

  it('keeps the plan visible without activity or meeting links before cohort start',()=>{
    render(<MemoryRouter><TrainingPlanDetails data={fixture()} subjects={subjects} kind="commercial" learnerId="499"
      onRefresh={vi.fn()} onRetryContract={vi.fn()} canOpenActivities={false}/></MemoryRouter>);
    expect(screen.getByRole('region',{name:'Monthly study plan'})).toBeVisible();
    expect(screen.getByRole('region',{name:'Module timeline'})).toBeVisible();
    expect([...document.querySelectorAll('a')].filter(link=>link.getAttribute('href')?.startsWith('/learner/modules/'))).toHaveLength(0);
    expect(screen.queryByRole('link',{name:'Join Teams'})).not.toBeInTheDocument();
  });
  it('places the timeline beside the module overview below monthly learning',()=>{
    renderBoard();
    expect(screen.getByRole('link',{name:'View full timeline'})).toHaveAttribute('href','#module-timeline');
    const cards=screen.getByRole('region',{name:'Module overview'});
    const timeline=screen.getByRole('region',{name:'Module timeline'});
    expect(timeline.parentElement?.parentElement).toBe(cards.parentElement);
    expect(timeline.compareDocumentPosition(cards)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('moves the month controls with the panel and supports year boundaries',()=>{
    renderBoard();
    const panel=within(screen.getByRole('region',{name:'Monthly study plan'}));
    expect(panel.getByRole('heading',{name:'September 2026'})).toBeVisible();
    fireEvent.change(screen.getByLabelText('Focus month'),{target:{value:'2026-10'}});
    expect(panel.getByRole('heading',{name:'October 2026'})).toBeVisible();
    expect(panel.getAllByText('20')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button',{name:'Next month'}));
    expect(panel.getByRole('heading',{name:'November 2026'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Previous month'}));
    fireEvent.change(screen.getByLabelText('Focus month'),{target:{value:'2026-12'}});
    fireEvent.click(screen.getByRole('button',{name:'Next month'}));
    expect(panel.getByRole('heading',{name:'January 2027'})).toBeVisible();
    expect(screen.getByLabelText('Focus month')).toHaveValue('2027-01');
  });
  it('shares the timeline month controls with the cards and selects module details without navigating away',()=>{
    renderBoard();
    expect(screen.getByRole('progressbar',{name:'Marketing activity progress'})).toHaveAttribute('aria-valuenow','50');
    fireEvent.click(screen.getByRole('button',{name:'October 2026 — Research'}));
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-10');
    fireEvent.change(screen.getByRole('combobox',{name:'Timeline year'}),{target:{value:'2027'}});
    fireEvent.click(screen.getByRole('button',{name:'Today'}));
    expect(screen.getByRole('combobox',{name:'Timeline year'})).toHaveValue('2026');
    fireEvent.click(screen.getByRole('button',{name:'Show New module overview'}));
    expect(screen.getByRole('combobox',{name:'Focus module'})).toHaveValue('current:NEW');
    expect(within(screen.getByRole('region',{name:'Module overview'})).getByRole('heading',{name:'New module'})).toBeVisible();
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary',{name:'Timeline module details'})).not.toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
  it('preserves selected month calculations and filters actual attendance',()=>{
    renderBoard();
    const panel=within(screen.getByRole('region',{name:'Monthly study plan'}));
    for(const value of ['18','11.5','6.5','4.5'])expect(panel.getByText(value)).toBeVisible();
    fireEvent.change(panel.getByRole('combobox',{name:'Filter monthly sessions'}),{target:{value:'completed'}});
    expect(panel.getByText('Attended session')).toBeVisible();
    expect(panel.queryByText('Missed session')).not.toBeInTheDocument();
    fireEvent.change(panel.getByRole('combobox',{name:'Filter monthly sessions'}),{target:{value:'pending'}});
    expect(panel.getByText('Missed session')).toBeVisible();
    expect(panel.getByText('Next session')).toBeVisible();
    expect(panel.queryByText('Attended session')).not.toBeInTheDocument();
    fireEvent.change(panel.getByRole('combobox',{name:'Filter monthly sessions'}),{target:{value:'all'}});
    expect(panel.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button',{name:'Next month'}));
    expect(panel.getByRole('heading',{name:'October 2026'})).toBeVisible();
  });
  it('opens the selected Builder module overview including a module without dates',()=>{
    renderBoard();
    fireEvent.change(screen.getByRole('combobox',{name:'Focus module'}),{target:{value:'current:NEW'}});
    const panel=within(screen.getByRole('region',{name:'Module overview'}));
    expect(panel.getByRole('heading',{name:'New module'})).toBeVisible();
    expect(panel.getByText('Just assigned')).toBeVisible();
    fireEvent.click(panel.getByRole('link',{name:'Go to module'}));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/modules/commercial/125?subject=current%3ANEW');
  });
  it.each(['View activities in Marketing','Go to module','View session materials'])('navigates %s to the learner and subject it displays',(label)=>{
    renderBoard();
    fireEvent.click(screen.getAllByRole('link',{name:label})[0]);
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/modules/commercial/125?subject=legacy%3A10');
  });
  it.each([['Schedule','overdue'],['View booking','booked'],['View','done']])('opens %s on the specific review',(label,id)=>{
    renderBoard();
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    const panel=within(screen.getByRole('region',{name:'Programme reviews'}));
    fireEvent.click(panel.getAllByRole('link',{name:label})[0]);
    expect(screen.getByTestId('destination')).toHaveTextContent(`/learner/calendar?kind=commercial&learner=125&event=${id}`);
  });
  it('opens review markers and the full review list with the same learner',()=>{
    renderBoard();
    fireEvent.click(screen.getByRole('link',{name:'Progress Review on 8 Sept'}));
    expect(screen.getByTestId('destination')).toHaveTextContent('event=overdue');
    cleanup();renderBoard();
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    fireEvent.click(screen.getByRole('link',{name:'View all your reviews'}));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/progress-reviews?kind=commercial&learner=125');
  });
  it('uses the assigned coach booking URL and exact Teams occurrence URL',()=>{
    renderBoard();
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    for(const label of ['Book a support session'])expect(screen.getByRole('link',{name:label})).toHaveAttribute('href','https://outlook.office.com/book/assigned-coach');
    fireEvent.click(screen.getByRole('tab',{name:'Live Sessions'}));
    for(const label of ['Join Teams']){
      const link=screen.getByRole('link',{name:label});
      expect(link).toHaveAttribute('href','https://teams.microsoft.com/l/meetup-join/verified');
      expect(link).toHaveAttribute('target','_blank');
    }
  });
  it('uses a support booking fallback and keeps absent bookings/sessions non-interactive',()=>{
    const data=fixture();data.reviews=[];data.sessions=[];renderBoard(data);
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    expect(screen.getAllByRole('link',{name:'Book a support session'})).toHaveLength(1);
    expect(screen.queryByRole('link',{name:'Join live session'})).not.toBeInTheDocument();
    cleanup();data.coach.bookingUrl=null;renderBoard(data);
    fireEvent.click(screen.getByRole('tab',{name:'Reviews'}));
    expect(screen.queryByRole('link',{name:/support session/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Book review'})).not.toBeInTheDocument();
  });
});
