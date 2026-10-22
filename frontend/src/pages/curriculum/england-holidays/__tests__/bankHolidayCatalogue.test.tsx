import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumHoliday, CurriculumHolidayInput } from '@/lib/curriculumApi';
import { holidayDateStatus, periodDays, uniqueClosedDays } from '../calendar';

const api = vi.hoisted(() => ({ read: vi.fn(), logs: vi.fn(), sync: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), confirm: vi.fn(), alert: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({children}:{children:ReactNode})=><div>{children}</div> }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({showCurriculumAlert:api.alert,showCurriculumConfirm:api.confirm}));
vi.mock('@/components/feature/DatePickerField', () => ({ DatePickerField: ({label,value,onChange,disabled,min}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;min?:string}) => <label>{label}<input type="date" value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} min={min}/></label> }));
vi.mock('@/lib/curriculumApi', async original => ({...(await original<typeof import('@/lib/curriculumApi')>()),fetchCurriculumHolidays:api.read,fetchEnglandHolidaySyncs:api.logs,refreshEnglandHolidays:api.sync,createCurriculumHoliday:api.create,updateCurriculumHoliday:api.update,archiveCurriculumHoliday:api.archive}));
let holidays: CurriculumHoliday[];
const base = (): CurriculumHoliday[] => [
  {id:'england-and-wales:2026-12-25',label:'Christmas Day',startDate:'2026-12-25',endDate:'2026-12-25',source:'gov.uk'},
  {id:'CROSS',label:'College closure',startDate:'2026-12-24',endDate:'2027-01-02',source:'authored',type:'College',color:'#456789'},
  {id:'OVERLAP',label:'Overlapping closure',startDate:'2026-12-28',endDate:'2026-12-31',source:'authored'},
  {id:'SINGLE',label:'Training day',startDate:'2027-02-01',endDate:'2027-02-01',source:'authored'},
  {id:'PAST',label:'Past closure',startDate:'2026-01-01',endDate:'2026-01-03',source:'authored'},
];
async function open() { const {default:Page}=await import('../page');return render(<MemoryRouter><Page/></MemoryRouter>); }
async function choose(field:string,value:string) { await userEvent.click(screen.getByRole('combobox',{name:field}));await userEvent.click(await screen.findByRole('option',{name:value})); }
const card=(name:string,id:string)=>within(screen.getByRole('article',{name:`${name} - ${id}`}));
async function fill(name:string,start:string,end='') {
  await userEvent.type(screen.getByPlaceholderText('e.g. College closure'),name);
  fireEvent.change(screen.getByLabelText('Start date'),{target:{value:start}});
  if(end)fireEvent.change(screen.getByLabelText('End date'),{target:{value:end}});
}

describe('Bank holidays catalogue with existing calendar contracts',()=>{
  beforeEach(()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    holidays=base();api.read.mockReset().mockImplementation(async()=>[...holidays]);
    api.logs.mockReset().mockResolvedValue({status:{source:'https://www.gov.uk/bank-holidays.json',lastSuccessAt:'2026-10-20T09:00:00Z'},results:[]});
    api.sync.mockReset().mockResolvedValue({summary:{added:[],changed:[],moved:[],withdrawn:[],feedCount:1}});
    api.create.mockReset().mockImplementation(async(input:CurriculumHolidayInput)=>{holidays.push({id:'NEW',...input} as CurriculumHoliday);return {created:true};});
    api.update.mockReset().mockImplementation(async(id:string,input:CurriculumHolidayInput)=>{holidays=holidays.map(item=>item.id===id?{...item,...input}:item);return {updated:true};});
    api.archive.mockReset().mockImplementation(async(id:string)=>{holidays=holidays.filter(item=>item.id!==id);return {archived:true};});
    api.confirm.mockReset().mockResolvedValue(undefined);api.alert.mockReset().mockResolvedValue(undefined);
  });
  afterEach(()=>vi.useRealTimers());

  it('counts complete stored periods and unique days without inventing applied/session totals or week-long bank holidays',async()=>{
    await open();await screen.findByRole('article',{name:'College closure - CROSS'});
    const totals=within(screen.getByLabelText('Closure totals'));
    expect(totals.getByText('Closure periods').previousElementSibling).toHaveTextContent('5');
    expect(totals.getByText('14 unique closed days')).toBeInTheDocument();
    expect(totals.getByText('Applied to delivery').previousElementSibling).toHaveTextContent('Unavailable');
    expect(totals.getByText('Sessions moved').previousElementSibling).toHaveTextContent('Unavailable');
    expect(card('Christmas Day','england-and-wales:2026-12-25').getByText('1-day period')).toBeInTheDocument();
    expect(card('College closure','CROSS').getByText('24 Dec 2026 – 02 Jan 2027')).toBeInTheDocument();
    expect(card('Past closure','PAST').getByText('Past')).toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Next closure'})).toHaveTextContent('College closure');
    expect(api.sync).not.toHaveBeenCalled();expect(api.create).not.toHaveBeenCalled();
  });

  it('preserves start-year rules, month search and shared filters across month/table views',async()=>{
    await open();await screen.findByRole('article',{name:'College closure - CROSS'});
    await userEvent.type(screen.getByPlaceholderText('Search bank holidays...'),'December');
    expect(screen.getByText('Showing 3 of 5 holidays')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Table'}));expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('College closure')).toBeInTheDocument();
    await choose('Year','2027');expect(screen.getByText('Showing 0 of 5 holidays')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Reset'}));await choose('Year','2027');
    expect(screen.getByText('Showing 1 of 5 holidays')).toBeInTheDocument();expect(screen.getByText('Training day')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'By month'}));expect(card('Training day','SINGLE').getByText('Training day')).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('keeps GOV.UK records read-only and preserves supported manual actions',async()=>{
    await open();await screen.findByRole('article',{name:'Christmas Day - england-and-wales:2026-12-25'});
    expect(card('Christmas Day','england-and-wales:2026-12-25').queryByRole('button',{name:/Edit|Delete/})).not.toBeInTheDocument();
    expect(card('College closure','CROSS').getByRole('button',{name:'Edit College closure'})).toBeEnabled();
    await choose('Source','GOV.UK');expect(screen.getAllByRole('article')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button',{name:'Table'}));expect(screen.queryByRole('button',{name:'Edit'})).not.toBeInTheDocument();
  });

  it('creates a deliberate manual interval through the unchanged payload and authoritative refresh',async()=>{
    await open();await screen.findByRole('button',{name:'Add manual holiday'});await userEvent.click(screen.getByRole('button',{name:'Add manual holiday'}));
    await fill('New closure','2027-03-01','2027-03-04');await userEvent.click(screen.getByRole('button',{name:'Add holiday'}));
    await waitFor(()=>expect(api.create).toHaveBeenCalledWith({label:'New closure',startDate:'2027-03-01',endDate:'2027-03-04',type:'',color:'#7c3aed'}));
    expect(await screen.findByRole('article',{name:'New closure - NEW'})).toBeInTheDocument();
    expect(api.read).toHaveBeenLastCalledWith(undefined,{skipCache:true,revalidate:false});
  });

  it('edits only the selected manual record without changing its full date range',async()=>{
    await open();await userEvent.click(await screen.findByRole('button',{name:'Edit College closure'}));
    expect(screen.getByLabelText('End date')).toHaveValue('2027-01-02');
    await userEvent.clear(screen.getByPlaceholderText('e.g. College closure'));await userEvent.type(screen.getByPlaceholderText('e.g. College closure'),'Renamed closure');
    await userEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await waitFor(()=>expect(api.update).toHaveBeenCalledWith('CROSS',expect.objectContaining({label:'Renamed closure',startDate:'2026-12-24',endDate:'2027-01-02'})));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('rejects reversed dates and treats a blank end as one day',async()=>{
    await open();await userEvent.click(screen.getByRole('button',{name:'Add manual holiday'}));
    await fill('Single closure','2027-04-05','2027-04-04');expect(screen.getByRole('button',{name:'Add holiday'})).toBeDisabled();expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('End date'),{target:{value:''}});await userEvent.click(screen.getByRole('button',{name:'Add holiday'}));
    await waitFor(()=>expect(api.create).toHaveBeenCalledWith(expect.objectContaining({startDate:'2027-04-05',endDate:'2027-04-05'})));
  });

  it('syncs only on a deliberate action, blocks duplicate checks and rereads authoritative data',async()=>{
    let resolve!:(value:unknown)=>void;api.sync.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    await open();await screen.findByRole('article',{name:'College closure - CROSS'});expect(api.sync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'Check GOV.UK now'}));fireEvent.click(screen.getByRole('button',{name:'Check GOV.UK now'}));expect(api.sync).toHaveBeenCalledTimes(1);
    await act(async()=>resolve({summary:{added:[],changed:[],moved:[],withdrawn:[],feedCount:1}}));
    await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2));
  });

  it('preserves delete confirmation, cancellation and exact manual record identity',async()=>{
    await open();await userEvent.click(await screen.findByRole('button',{name:'Delete College closure'}));expect(api.archive).not.toHaveBeenCalled();
    api.confirm.mockImplementationOnce(async(options:{onConfirm:()=>Promise<void>})=>options.onConfirm());
    await userEvent.click(screen.getByRole('button',{name:'Delete College closure'}));await waitFor(()=>expect(api.archive).toHaveBeenCalledWith('CROSS'));
    await waitFor(()=>expect(screen.queryByRole('article',{name:'College closure - CROSS'})).not.toBeInTheDocument());
  });

  it('distinguishes a committed save from a failed refresh and prevents duplicate creation',async()=>{
    await open();await screen.findByRole('article',{name:'College closure - CROSS'});api.read.mockRejectedValueOnce(new Error('Refresh unavailable'));
    await userEvent.click(screen.getByRole('button',{name:'Add manual holiday'}));await fill('Saved closure','2027-05-01');await userEvent.click(screen.getByRole('button',{name:'Add holiday'}));
    await waitFor(()=>expect(api.alert).toHaveBeenCalledWith(expect.objectContaining({title:'Holiday saved; calendar refresh failed'})));
    expect(screen.getByRole('button',{name:'Add manual holiday'})).toBeDisabled();expect(api.create).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button',{name:'Retry'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Add manual holiday'})).toBeEnabled());
    expect(api.create).toHaveBeenCalledTimes(1);expect(await screen.findByRole('article',{name:'Saved closure - NEW'})).toBeInTheDocument();
  });

  it('distinguishes failed reads, verified zero and unavailable sync metadata',async()=>{
    api.read.mockRejectedValueOnce(new Error('Calendar unavailable'));const first=await open();await screen.findByText('Calendar unavailable');
    expect(within(screen.getByLabelText('Closure totals')).getByText('Closure periods').previousElementSibling).toHaveTextContent('Unavailable');first.unmount();
    holidays=[];api.logs.mockRejectedValueOnce(new Error('Log unavailable'));await open();
    await waitFor(()=>expect(within(screen.getByLabelText('Closure totals')).getByText('Closure periods').previousElementSibling).toHaveTextContent('0'));
    expect(screen.getByText('Last successful check: Unavailable')).toBeInTheDocument();
  });
});

describe('Stored holiday interval metrics',()=>{
  it('unions overlaps across a year boundary without expanding feed dates',()=>{
    expect(uniqueClosedDays(base())).toBe(14);expect(periodDays(base()[0])).toBe(1);expect(periodDays(base()[1])).toBe(10);
  });
  it('retains leap days and treats malformed/reversed periods as unavailable',()=>{
    const holiday={...base()[0],startDate:'2028-02-28',endDate:'2028-03-01'};
    expect(periodDays(holiday)).toBe(3);expect(uniqueClosedDays([])).toBe(0);
    expect(uniqueClosedDays([{...holiday,startDate:'2028-02-30'}])).toBeNull();
    expect(periodDays({...holiday,endDate:'2028-02-27'})).toBeNull();
  });
  it('uses date status without asserting delivery application',()=>{
    const holiday=base()[1];expect(holidayDateStatus(holiday,'2026-12-23')).toBe('upcoming');expect(holidayDateStatus(holiday,'2027-01-01')).toBe('current');expect(holidayDateStatus(holiday,'2027-01-03')).toBe('past');
  });
});
