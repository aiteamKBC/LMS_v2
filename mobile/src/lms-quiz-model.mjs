/** Translate freshly fetched LMS quiz data without exposing a grading key.
 *
 * The LMS shuffles answers on each GET. Letters are UI labels, never server IDs.
 * A draft stores canonical selected IDs; a fresh response must validate it before
 * current letters can be restored. This module does not grade or award points.
 */
import {normaliseAnswer, normaliseAnswers, answerIds} from './quiz-model.mjs';
import {learningMediaUrl} from './lms-learning-model.mjs';

function optionLabel(index){
  let result='';for(let position=index+1;position>0;position=Math.floor((position-1)/26))result=String.fromCharCode(65+(position-1)%26)+result;
  return result;
}
const SUPPORTED=new Set(['single_choice','multiple_choice','true_false']);
const freshModels=new WeakMap();
const latestRevision=new Map();
export class LmsQuizMappingError extends Error {
  constructor(message,code='INVALID_LMS_QUIZ') {
    super(message);this.name='LmsQuizMappingError';this.code=code;
  }
}
const fail=(message,code)=>{throw new LmsQuizMappingError(message,code);};
function questionImage(value){
  if(value===undefined||value===null||value==='')return null;
  const invalid=()=>fail('This question image cannot be displayed safely. Open the quiz in the LMS or ask the college to check it.','UNSUPPORTED_QUESTION_IMAGE');
  if(typeof value!=='string')return invalid();
  if(value.startsWith('data:')){
    const match=value.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
    if(!match||!match[2]||match[2].length%4)return invalid();
    const encoded=match[2],bytes=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
    if(bytes<12||bytes>5*1024*1024)return invalid();
    // Check the raster signature; full decoding remains the native image renderer's job.
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',header=[];
    for(let i=0;i<Math.min(encoded.length,24);i+=4){const n=(alphabet.indexOf(encoded[i])<<18)|(alphabet.indexOf(encoded[i+1])<<12)|(alphabet.indexOf(encoded[i+2])<<6)|alphabet.indexOf(encoded[i+3]);header.push((n>>>16)&255,(n>>>8)&255,n&255);}
    const ascii=(start,length)=>String.fromCharCode(...header.slice(start,start+length));
    const valid=match[1]==='png'?header.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':match[1]==='jpeg'?header[0]===255&&header[1]===216&&header[2]===255:match[1]==='gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP';
    if(!valid)return invalid();
    return value;
  }
  if(value.length>12000)return invalid();
  const url=learningMediaUrl(value,'audio');
  if(!url)return invalid();
  return url;
}
function numericId(value,label) {
  if(typeof value==='boolean'||!['number','string'].includes(typeof value)
      || !/^[1-9][0-9]*$/.test(String(value)))fail(label+' must be a canonical positive ID.');
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<=0)fail(label+' cannot be represented safely.');
  return parsed;
}
function text(value,label,{empty=false}={}) {
  if(typeof value!=='string'||(!empty&&!value.trim())||value.length>20000)fail(label+' is invalid.');
  return value;
}
function ownObject(value) {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function deepFreeze(value) {
  if(value&&typeof value==='object'){for(const entry of Object.values(value))deepFreeze(entry);Object.freeze(value);}
  return value;
}
function requireFresh(quiz) {
  if(!ownObject(quiz)||!freshModels.has(quiz)||freshModels.get(quiz)!==latestRevision.get(quiz.id)) {
    fail('Fetch the current LMS quiz before restoring or submitting answers.','FRESH_QUIZ_REQUIRED');
  }
}
function contentFingerprint(quiz) {
  // Exact structural equality, not a short collision-prone hash or an auth token.
  // Ignore ordering: server randomisation must not erase otherwise unchanged work.
  const questions=quiz.questions.map(q=>{
    const content=[q.id,q.lmsQuestionType,q.prompt,q.options.map(o=>[o.lmsAnswerId,o.text]).sort((a,b)=>a[0]-b[0])];
    if(q.imageUrl)content.push(['questionImage',q.imageUrl]);
    return content;
  })
    .sort((a,b)=>Number(a[0])-Number(b[0]));
  return JSON.stringify(['lms-quiz-content-v1',quiz.id,quiz.lmsQuizId,quiz.title,
    quiz.passMark??null,quiz.version??null,questions]);
}

/** Call with the response just returned by GET mobile/quizzes/{componentId}/. */
export function normaliseLmsQuiz(raw,{componentId}={}) {
  if(typeof componentId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(componentId)) {
    fail('A canonical LMS activity ID is required.');
  }
  if(!ownObject(raw)||!Array.isArray(raw.questions)||!raw.questions.length||raw.questions.length>250) {
    fail('The LMS quiz needs a non-empty question list.');
  }
  const lmsQuizId=numericId(raw.id,'Quiz ID'),seenQuestions=new Set(),seenAnswers=new Set();
  const questions=raw.questions.map(q=>{
    if(!ownObject(q)||!SUPPORTED.has(q.type))fail('This LMS question format is not supported.','UNSUPPORTED_QUESTION_TYPE');
    const qid=numericId(q.id,'Question ID');
    if(seenQuestions.has(qid))fail('Question IDs must be unique.');
    seenQuestions.add(qid);
    if(!Array.isArray(q.answers)||q.answers.length<2
       ||(q.type==='true_false'&&q.answers.length!==2))fail('A choice question needs at least two valid options; true or false needs exactly two.');
    const options=q.answers.map((option,index)=>{
      if(!ownObject(option))fail('A question option is invalid.');
      const id=numericId(option.id,'Answer ID');
      if(seenAnswers.has(id))fail('Answer IDs must be unique across the quiz.');
      seenAnswers.add(id);
      // Explicit allowlist: isCorrect/explanation/answer keys never pass through.
      return{id:optionLabel(index),text:text(option.text,'Option text'),lmsAnswerId:id};
    });
    return{id:String(qid),prompt:text(q.text,'Question text'),imageUrl:questionImage(q.imageUrl),
      selectionMode:q.type==='multiple_choice'?'multiple':'single',
      lmsQuestionType:q.type,options};
  });
  const quiz={id:componentId,lmsQuizId,title:text(raw.title,'Quiz title'),questions};
  if(raw.passingGrade!==undefined&&raw.passingGrade!==null) {
    const value=raw.passingGrade;
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)fail('The quiz pass mark is invalid.');
    quiz.passMark=value;
  }
  if(raw.duration!==undefined&&raw.duration!==null) {
    if(typeof raw.duration!=='number'||!Number.isFinite(raw.duration)||raw.duration<0)fail('The quiz duration is invalid.');
    quiz.duration=raw.duration;
  }
  if(typeof raw.timeUnit==='string')quiz.timeUnit=text(raw.timeUnit,'Time unit',{empty:true});
  if(raw.version!==undefined&&raw.version!==null) {
    if(!['string','number'].includes(typeof raw.version))fail('The quiz version is invalid.');
    quiz.version=String(raw.version);
  }
  quiz.contentFingerprint=contentFingerprint(quiz);
  // This second signature identifies the *display* map, which can change on GET.
  quiz.mappingFingerprint=JSON.stringify(['lms-quiz-display-v1',quiz.contentFingerprint,
    quiz.questions.map(q=>[q.id,q.options.map(o=>[o.id,o.lmsAnswerId])])]);
  deepFreeze(quiz);
  const revision=(latestRevision.get(componentId)||0)+1;
  latestRevision.set(componentId,revision);freshModels.set(quiz,revision);return quiz;
}

function mapSelections(quiz,answers,{partial=false}={}) {
  requireFresh(quiz);
  if(!ownObject(answers))fail('Choose valid answers for this quiz.','INVALID_LOCAL_ANSWERS');
  const byId=new Map(quiz.questions.map(q=>[q.id,q]));
  if(Object.keys(answers).some(id=>!byId.has(id)))fail('An answer refers to another question.','INVALID_LOCAL_ANSWERS');
  let selected;
  try {
    selected=partial?Object.fromEntries(Object.entries(answers).map(([id,value])=>[
      id,normaliseAnswer(byId.get(id),value)])):normaliseAnswers(quiz.questions,answers);
  } catch {fail('Choose valid options for every answered question.','INVALID_LOCAL_ANSWERS');}
  return Object.fromEntries(Object.entries(selected).map(([id,value])=>{
    const question=byId.get(id),mapping=new Map(question.options.map(o=>[o.id,o.lmsAnswerId]));
    const ids=answerIds(value).map(letter=>mapping.get(letter));
    return[id,question.selectionMode==='multiple'?ids:ids[0]];
  }));
}

/** All questions required; result is the exact answers object for LMS submission. */
export function mapLmsQuizAnswers(freshQuiz,localSelections) {
  return mapSelections(freshQuiz,localSelections);
}

/** Persist only selected canonical IDs, never a persisted A-E -> ID mapping. */
export function createLmsQuizDraft(freshQuiz,partialSelections={}) {
  const answers=mapSelections(freshQuiz,partialSelections,{partial:true});
  return{schemaVersion:1,componentId:freshQuiz.id,lmsQuizId:freshQuiz.lmsQuizId,
    contentFingerprint:freshQuiz.contentFingerprint,answers};
}

/** Rebase a draft onto a freshly fetched, possibly reshuffled quiz.
 * Changed IDs, text, quiz identity, pass mark or version invalidate the whole draft.
 */
export function validateLmsQuizDraft(freshQuiz,draft) {
  requireFresh(freshQuiz);
  const invalid=reason=>({valid:false,reason,answers:{}});
  if(!ownObject(draft)||draft.schemaVersion!==1||!ownObject(draft.answers))return invalid('INVALID_DRAFT');
  if(draft.componentId!==freshQuiz.id||draft.lmsQuizId!==freshQuiz.lmsQuizId
      ||draft.contentFingerprint!==freshQuiz.contentFingerprint)return invalid('QUIZ_CHANGED');
  const byId=new Map(freshQuiz.questions.map(q=>[q.id,q])),restored={};
  if(Object.keys(draft.answers).some(id=>!byId.has(id)))return invalid('INVALID_DRAFT');
  for(const[id,value]of Object.entries(draft.answers)) {
    const question=byId.get(id),multiple=question.selectionMode==='multiple';
    if(multiple?(!Array.isArray(value)||!value.length):Array.isArray(value))return invalid('INVALID_DRAFT');
    const selected=multiple?value:[value];
    if(selected.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<=0)
       ||new Set(selected).size!==selected.length)return invalid('INVALID_DRAFT');
    const wanted=new Set(selected);
    const labels=question.options.filter(o=>wanted.has(o.lmsAnswerId)).map(o=>o.id);
    if(labels.length!==selected.length)return invalid('QUIZ_CHANGED');
    restored[id]=multiple?labels:labels[0];
  }
  return{valid:true,reason:null,answers:restored};
}

