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
  it('jumps to the timeline below the cards',()=>{
    renderBoard();
    expect(screen.getByRole('link',{name:'View full timeline'})).toHaveAttribute('href','#module-timeline');
    const cards=screen.getByRole('region',{name:'Module overview'});
    const timeline=screen.getByRole('region',{name:'Module timeline'});
    expect(cards.compareDocumentPosition(timeline)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getByRole('complementary',{name:'Timeline module details'})).toBeVisible();
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
  it.each([['Book now','overdue'],['View booking','booked'],['View','done']])('opens %s on the specific review',(label,id)=>{
    renderBoard();
    const panel=within(screen.getByRole('region',{name:'Reviews this period'}));
    fireEvent.click(panel.getAllByRole('link',{name:label})[0]);
    expect(screen.getByTestId('destination')).toHaveTextContent(`/learner/calendar?kind=commercial&learner=125&event=${id}`);
  });
  it('opens review markers and the full review list with the same learner',()=>{
    renderBoard();
    fireEvent.click(screen.getByRole('link',{name:'Progress Review on 8 Sept'}));
    expect(screen.getByTestId('destination')).toHaveTextContent('event=overdue');
    cleanup();renderBoard();
    fireEvent.click(screen.getByRole('link',{name:'View all your reviews'}));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/progress-reviews?kind=commercial&learner=125');
  });
  it('uses the assigned coach booking URL and exact Teams occurrence URL',()=>{
    renderBoard();
    for(const label of ['Book a support session'])expect(screen.getByRole('link',{name:label})).toHaveAttribute('href','https://outlook.office.com/book/assigned-coach');
    for(const label of ['Join Teams']){
      const link=screen.getByRole('link',{name:label});
      expect(link).toHaveAttribute('href','https://teams.microsoft.com/l/meetup-join/verified');
      expect(link).toHaveAttribute('target','_blank');
    }
  });
  it('uses a support booking fallback and keeps absent bookings/sessions non-interactive',()=>{
    const data=fixture();data.reviews=[];data.sessions=[];renderBoard(data);
    expect(screen.getAllByRole('link',{name:'Book a support session'})).toHaveLength(1);
    expect(screen.queryByRole('link',{name:'Join live session'})).not.toBeInTheDocument();
    cleanup();data.coach.bookingUrl=null;renderBoard(data);
    expect(screen.queryByRole('link',{name:/support session/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Book review'})).not.toBeInTheDocument();
  });
});
