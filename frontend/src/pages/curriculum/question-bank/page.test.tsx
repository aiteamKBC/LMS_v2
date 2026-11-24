import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import QuestionBankPage from './page';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const fetchMock = vi.fn();
const question = { id:1, text:'A saved quiz question', imageUrl:'', questionType:'single_choice', explanation:'K1',
  quizStatus:'published', programme:'Programme A', programmeKey:'Programme A', module:'Module', quizId:10,
  quizTitle:'Existing quiz', answers:[{id:100,text:'Correct option',isCorrect:true}] };
const data = { programmes:[{name:'Programme A',key:'Programme A',questionCount:80,quizCount:2}],
  questions:[question], quizzes:[{id:10,title:'Existing quiz',programmeKey:'Programme A',questions:40,status:'published'},
    {id:11,title:'Another quiz',programmeKey:'Programme A',questions:40,status:'draft'}],
  totalQuestions:80, statuses:['draft','published'], ksbTaggedCount:40,
  pagination:{page:1,pageSize:25,total:80,totalPages:4} };
const response = (value: unknown = data, status = 200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}});
function mount(url = '/curriculum/question-bank') {render(<MemoryRouter initialEntries={[url]}><QuestionBankPage /></MemoryRouter>);}
beforeEach(() => {fetchMock.mockReset().mockImplementation(()=>Promise.resolve(response()));vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('AppIcon',AppIcon);});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

it('loads a bounded page, uses the full matching count, and requests the next page', async () => {
  mount();
  expect(await screen.findByText(question.text)).toBeVisible();
  expect(screen.getByText('1 of 80 questions shown')).toBeVisible();
  expect(screen.getByText('50%')).toBeVisible();
  expect(fetchMock.mock.calls[0][0]).toContain('pageSize=25');
  fetchMock.mockResolvedValue(response({...data,pagination:{...data.pagination,page:2}}));
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await waitFor(()=>expect(fetchMock.mock.calls.at(-1)![0]).toContain('page=2'));
  expect(await screen.findByText('Page 2 of 4')).toBeVisible();
});

it('shows a load failure with retry instead of zero counts and an empty bank', async () => {
  fetchMock.mockResolvedValue(response({error:'unavailable'},503));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('503');
  expect(screen.queryByText('No questions match this view')).not.toBeInTheDocument();
  expect(screen.getByText('Question count unavailable')).toBeVisible();
  fetchMock.mockResolvedValue(response());
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  expect(await screen.findByText(question.text)).toBeVisible();
});

it('rejects an incomplete success response instead of treating it as an empty bank', async () => {
  fetchMock.mockResolvedValue(response({results:[]}));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('incomplete');
  expect(screen.queryByText('No questions match this view')).not.toBeInTheDocument();
});

it('keeps filters in the URL request and resets pagination when searching', async () => {
  mount('/curriculum/question-bank?programme=Programme+A&type=single_choice&status=published&page=3');
  await screen.findByText(question.text);
  const params = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams;
  expect(Object.fromEntries(params)).toMatchObject({programme:'Programme A',type:'single_choice',status:'published',page:'3'});
  fireEvent.change(screen.getByRole('textbox',{name:'Search question bank'}),{target:{value:'saved'}});
  await waitFor(()=>expect(fetchMock.mock.calls.at(-1)![0]).toContain('search=saved'));
  expect(fetchMock.mock.calls.at(-1)![0]).toContain('page=1');
});

it('does not replace a newer search result when an old request finishes late', async () => {
  let finish: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
  mount();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('textbox',{name:'Search question bank'}),{target:{value:'saved'}});
  expect(await screen.findByText(question.text)).toBeVisible();
  await act(async()=>{finish(response({...data,questions:[],totalQuestions:0}));});
  await waitFor(()=>expect(screen.getByText(question.text)).toBeVisible());
});

it('preserves the add-to-quiz target and payload', async () => {
  fetchMock.mockImplementation((_url,init)=>Promise.resolve(response(init?.method==='POST'?{created:true}:data)));
  mount();
  await screen.findByText(question.text);
  fireEvent.click(screen.getByRole('button',{name:'Add to quiz'}));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Add question'}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([url,init])=>url.includes('/questions/1/add-to-quiz/') && init?.body===JSON.stringify({quizId:11}))).toBe(true));
});
