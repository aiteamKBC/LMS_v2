import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import TrainingPlanTimelinePage from './page';

const mocks=vi.hoisted(()=>({plan:vi.fn(),activity:vi.fn(),refresh:vi.fn(),retry:vi.fn(),details:new Map<string,LearnerDetail>(),metadata:new Map()}));
vi.mock('@/components/feature/WorkspaceShell',()=>({WorkspaceShell:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@/hooks/useLearnerDetailParam',()=>({useLearnerDetailParam:(_kind:string,id:string)=>({real:mocks.details.get(id),loading:false,loadError:null,refresh:mocks.refresh})}));
vi.mock('@/api/trainingPlanDashboard',()=>({fetchTrainingPlanDashboard:mocks.plan}));
vi.mock('@/api/studentActivity',async importOriginal=>({...await importOriginal<typeof import('@/api/studentActivity')>(),fetchStudentActivity:mocks.activity}));
vi.mock('../my-learning/SubjectWorkspace',async importOriginal=>({...await importOriginal<typeof import('../my-learning/SubjectWorkspace')>(),useSubjectMetadata:(_data:unknown,_real:unknown,_kind:string,id:string)=>({metadata:mocks.metadata.get(id),error:null,retry:mocks.retry})}));

function data():TrainingPlanDashboard{return {months:{},actual:[],actualAvailable:false,modules:[],moduleLinks:{},sessions:[],reviews:[],coach:{name:'',bookingUrl:null},contractStatus:'not-available',generatedAt:''};}
function renderPage(){return render(<MemoryRouter initialEntries={['/plan/commercial/1']}><Link to="/plan/commercial/2">Switch learner</Link><Routes><Route path="/plan/:kind/:id" element={<TrainingPlanTimelinePage/>}/></Routes></MemoryRouter>);}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>{
  mocks.plan.mockReset();mocks.activity.mockReset();mocks.refresh.mockReset();mocks.retry.mockReset();mocks.details.clear();mocks.metadata.clear();
  for(const id of ['1','2']){
    mocks.details.set(id,{name:`Learner ${id}`,programme:'Programme',modules:[`Subject ${id}`],components:[],studentActivityAvailable:true} as unknown as LearnerDetail);
    mocks.metadata.set(id,{covers:{},current_subjects:[{id:`M${id}`,title:`Subject ${id}`}],builder_subjects:{}});
  }
  mocks.plan.mockResolvedValue(data());mocks.activity.mockResolvedValue(null);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('Training Plan loading and refresh',()=>{
  it('retries a failed source request and refreshes the plan, activity and learner data',async()=>{
    mocks.plan.mockRejectedValueOnce(new Error('Source unavailable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable');
    fireEvent.click(screen.getByRole('button',{name:'Try again'}));
    await screen.findByRole('heading',{name:'My Training Plan'});
    expect(mocks.plan).toHaveBeenCalledTimes(2);expect(mocks.activity).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledOnce();expect(mocks.retry).toHaveBeenCalledOnce();
    mocks.plan.mockResolvedValue({...data(),coach:{name:'Updated coach',bookingUrl:'https://example.com/new-coach'}});
    fireEvent.click(screen.getByRole('button',{name:'Refresh training plan'}));
    await waitFor(()=>expect(screen.getByRole('link',{name:'Support session'})).toHaveAttribute('href','https://example.com/new-coach'));
    expect(mocks.plan.mock.calls.at(-1)?.slice(0,2)).toEqual(['commercial','1']);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it('aborts the previous learner request and never displays its late response for the new learner',async()=>{
    const first=deferred<TrainingPlanDashboard>();mocks.plan.mockImplementation((_kind:string,id:string)=>id==='1'?first.promise:Promise.resolve({...data(),coach:{name:'Second coach',bookingUrl:'https://example.com/second'}}));
    renderPage();
    await waitFor(()=>expect(mocks.plan).toHaveBeenCalledOnce());
    const signal=mocks.plan.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole('link',{name:'Switch learner'}));
    await screen.findByRole('heading',{name:'My Training Plan'});
    expect(signal.aborted).toBe(true);
    await act(async()=>first.resolve({...data(),coach:{name:'Wrong previous coach',bookingUrl:'https://example.com/first'}}));
    expect(screen.getByRole('link',{name:'Support session'})).toHaveAttribute('href','https://example.com/second');
    expect(screen.queryByText('Wrong previous coach')).not.toBeInTheDocument();
    expect(mocks.plan.mock.calls.at(-1)?.slice(0,2)).toEqual(['commercial','2']);
  });
});
