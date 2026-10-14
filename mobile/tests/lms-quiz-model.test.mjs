import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseLmsQuiz,mapLmsQuizAnswers,createLmsQuizDraft,validateLmsQuizDraft} from '../src/lms-quiz-model.mjs';
import {hasAnswer,toggleAnswer,parseQuizVoice} from '../src/quiz-model.mjs';

const fixture=()=>({id:77,title:'Stakeholders quiz',passingGrade:70,duration:10,timeUnit:'minutes',
  questions:[
    {id:101,text:'Choose one.',type:'single_choice',answers:[{id:502,text:'Second'},{id:501,text:'First'}]},
    {id:102,text:'Choose all that apply.',type:'multiple_choice',answers:[{id:602,text:'Beta'},{id:601,text:'Alpha'},{id:603,text:'Gamma'}]},
  ]});
const normalise=raw=>normaliseLmsQuiz(raw,{componentId:'PMP-W01-QUIZ'});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG9UAAAAASUVORK5CYII=';

test('question diagrams preserve canonical raster data and trusted material URLs without exposing answers',()=>{
 for(const image of [png,'/learner_api/materials/diagram.png','https://kbcmaterials.blob.core.windows.net/curriculum/diagram.png?sig=fixture','https://drive.google.com/file/d/SyntheticImageId123/view']){
  const raw=fixture();raw.questions[0].imageUrl=image;const model=normalise(raw);assert(model.questions[0].imageUrl);
  assert.equal(model.questions[1].imageUrl,null);assert.deepEqual(mapLmsQuizAnswers(model,{'101':'B','102':['A']}),{'101':501,'102':[602]});
 }
 assert.equal(normalise({...fixture(),questions:fixture().questions.map(q=>({...q,imageUrl:png}))}).questions[0].imageUrl,png);
});

test('unsupported or malformed diagram sources fail the quiz instead of silently hiding information',()=>{
 for(const image of ['javascript:alert(1)','https://attacker.test/a.png','https://kentbusinesscollege.org.attacker.test/a.png','https://user:pass@lms.kentbusinesscollege.org/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,aGVsbG8=',png.replace('image/png','image/jpeg'),false,23]){
  const raw=fixture();raw.questions[0].imageUrl=image;assert.throws(()=>normalise(raw),e=>e.code==='UNSUPPORTED_QUESTION_IMAGE');
 }
 const large=fixture();large.questions[0].imageUrl='data:image/png;base64,'+'A'.repeat(4*Math.ceil((5*1024*1024+1)/3));assert.throws(()=>normalise(large),e=>e.code==='UNSUPPORTED_QUESTION_IMAGE');
});

test('changing or removing a diagram invalidates old answers while text-only fingerprints stay backward compatible',()=>{
 const raw=fixture();raw.questions[0].imageUrl=png;const draft=createLmsQuizDraft(normalise(raw),{'101':'A'});
 raw.questions[0].imageUrl='https://kentbusinesscollege.org/replacement.png';assert.equal(validateLmsQuizDraft(normalise(raw),draft).reason,'QUIZ_CHANGED');
 raw.questions[0].imageUrl='';assert.equal(validateLmsQuizDraft(normalise(raw),draft).reason,'QUIZ_CHANGED');
 const plain=normalise(fixture()),questions=plain.questions.map(q=>[q.id,q.lmsQuestionType,q.prompt,q.options.map(o=>[o.lmsAnswerId,o.text]).sort((a,b)=>a[0]-b[0])]).sort((a,b)=>Number(a[0])-Number(b[0]));
 assert.equal(plain.contentFingerprint,JSON.stringify(['lms-quiz-content-v1',plain.id,plain.lmsQuizId,plain.title,plain.passMark,null,questions]));
});
test('fresh public IDs become native labels without deriving IDs from position',()=>{
 const quiz=normalise(fixture());
 assert.deepEqual(quiz.questions[0].options,[{id:'A',text:'Second',lmsAnswerId:502},{id:'B',text:'First',lmsAnswerId:501}]);
 assert.equal(quiz.questions[1].selectionMode,'multiple');assert.equal(quiz.id,'PMP-W01-QUIZ');assert.equal(quiz.lmsQuizId,77);
});
test('single answers become scalars and multi-select answers become ID arrays',()=>{
 const quiz=normalise(fixture());
 assert.deepEqual(mapLmsQuizAnswers(quiz,{'101':'B','102':['C','A']}),{'101':501,'102':[602,603]});
});
test('numeric string IDs are normalised but unsafe numeric IDs are rejected',()=>{
 const raw=fixture();raw.id='77';raw.questions[0].id='101';raw.questions[0].answers[0].id='502';
 assert.equal(normalise(raw).questions[0].options[0].lmsAnswerId,502);
 for(const invalid of [true,0,-1,1.5,'01','9007199254740993',Infinity]){
  const bad=fixture();bad.questions[0].answers[0].id=invalid;assert.throws(()=>normalise(bad));
 }
});
test('grading keys and explanations are stripped at every public output level',()=>{
 const raw=fixture();raw.correctAnswers='secret';raw.feedback='secret';raw.grade=100;
 raw.questions[0].correctOptionIds=['A'];raw.questions[0].explanation='secret';
 raw.questions[0].isCorrect=true;raw.questions[0].answers[0].isCorrect=true;
 raw.questions[0].answers[0].explanation='secret';
 const result=normalise(raw),output=JSON.stringify(result);
 for(const key of ['correctAnswers','correctOptionIds','isCorrect','explanation','feedback','grade','secret'])assert.equal(output.includes(key),false,key);
});
test('missing answers, invalid labels, unknown questions and duplicate selections are rejected',()=>{
 const quiz=normalise(fixture());
 for(const answers of [{},{'101':'C','102':['A']},{'101':'A','102':['A','A']},{'101':'A','102':['A'],'999':'A'},{'101':['A','B'],'102':['A']}]){
  assert.throws(()=>mapLmsQuizAnswers(quiz,answers),e=>e.code==='INVALID_LOCAL_ANSWERS');
 }
});
test('a persisted or copied mapping can never be submitted as a fresh model',()=>{
 const quiz=normalise(fixture()),copied=JSON.parse(JSON.stringify(quiz));
 assert.throws(()=>mapLmsQuizAnswers(copied,{'101':'A','102':['A']}),e=>e.code==='FRESH_QUIZ_REQUIRED');
 assert.throws(()=>validateLmsQuizDraft(copied,{}),e=>e.code==='FRESH_QUIZ_REQUIRED');
});
test('normalised display maps are frozen',()=>{
 const quiz=normalise(fixture());
 assert.throws(()=>{quiz.questions[0].options[0].lmsAnswerId=999;},TypeError);
 assert.throws(()=>{quiz.questions.reverse();},TypeError);
});
test('a draft stores canonical IDs and can be partial',()=>{
 const quiz=normalise(fixture()),draft=createLmsQuizDraft(quiz,{'101':'A'});
 assert.deepEqual(draft.answers,{'101':502});
 assert.equal(Object.hasOwn(draft,'questions'),false);
 assert.deepEqual(validateLmsQuizDraft(quiz,JSON.parse(JSON.stringify(draft))),{valid:true,reason:null,answers:{'101':'A'}});
});
test('server answer shuffling safely restores selections to the new letters',()=>{
 const raw=fixture(),old=normalise(raw),draft=createLmsQuizDraft(old,{'101':'A','102':['A','C']});
 raw.questions[0].answers.reverse();raw.questions[1].answers.reverse();raw.questions.reverse();
 const fresh=normalise(raw);
 assert.equal(old.contentFingerprint,fresh.contentFingerprint);
 assert.notEqual(old.mappingFingerprint,fresh.mappingFingerprint);
 const restored=validateLmsQuizDraft(fresh,draft);
 assert.equal(restored.valid,true);assert.equal(restored.answers['101'],'B');
 assert.deepEqual(mapLmsQuizAnswers(fresh,restored.answers),{'101':502,'102':[603,602]});
});
test('changed canonical IDs invalidate old answers even when text remains identical',()=>{
 const raw=fixture(),draft=createLmsQuizDraft(normalise(raw),{'101':'A'});
 raw.questions[0].answers[0].id=999;
 assert.deepEqual(validateLmsQuizDraft(normalise(raw),draft),{valid:false,reason:'QUIZ_CHANGED',answers:{}});
});
test('changed question text, option text or pass mark invalidate a draft',()=>{
 for(const change of [r=>r.questions[0].text='New meaning',r=>r.questions[0].answers[0].text='Changed',r=>r.passingGrade=80]){
  const raw=fixture(),draft=createLmsQuizDraft(normalise(raw),{'101':'A'});change(raw);
  assert.equal(validateLmsQuizDraft(normalise(raw),draft).valid,false);
 }
});
test('another quiz or component cannot reuse the draft',()=>{
 const raw=fixture(),draft=createLmsQuizDraft(normalise(raw),{'101':'A'});raw.id=78;
 assert.equal(validateLmsQuizDraft(normalise(raw),draft).reason,'QUIZ_CHANGED');
 assert.equal(validateLmsQuizDraft(normaliseLmsQuiz(fixture(),{componentId:'OTHER-QUIZ'}),draft).reason,'QUIZ_CHANGED');
});
test('forged or invalid draft answer fields never restore a selection',()=>{
 const quiz=normalise(fixture()),valid=createLmsQuizDraft(quiz,{'101':'A','102':['A']});
 for(const answers of [{'999':502},{'101':'A'},{'101':[502]},{'102':[602,602]},{'102':[true]},{'102':[999]}]){
  const result=validateLmsQuizDraft(quiz,{...valid,answers});assert.equal(result.valid,false);assert.deepEqual(result.answers,{});
 }
});
test('unsupported question types and duplicate source IDs are refused',()=>{
 for(const change of [r=>r.questions[0].type='matching',r=>r.questions[0].id=102,r=>r.questions[0].answers[0].id=501,r=>r.questions[0].answers[0].id=602]){
  const raw=fixture();change(raw);assert.throws(()=>normalise(raw));
 }
});
test('choice questions accept canonical options beyond the old five-option pilot and true-false retains its exact shape',()=>{
 const raw=fixture();raw.questions[0].type='true_false';
 assert.equal(normalise(raw).questions[0].selectionMode,'single');
 raw.questions[0].answers.push({id:503,text:'Third'});assert.throws(()=>normalise(raw));
 for(const type of ['single_choice','multiple_choice']){
  const many=fixture();many.questions=[{id:101,text:'Six choices',type,answers:Array.from({length:6},(_,i)=>({id:700+i,text:'Option '+i}))}];
  const quiz=normalise(many),question=quiz.questions[0];assert.equal(question.options[5].id,'F');
  const answer=type==='multiple_choice'?['A','F']:'F';assert(hasAnswer(question,answer));
  assert.deepEqual(mapLmsQuizAnswers(quiz,{'101':answer}),{'101':type==='multiple_choice'?[700,705]:705});
  assert.deepEqual(parseQuizVoice(type==='multiple_choice'?'A and F':'option F',question),type==='multiple_choice'?['A','F']:['F']);
  assert.deepEqual(toggleAnswer(question,type==='multiple_choice'?['A']:undefined,'F'),answer);
 }
 const many=fixture();many.questions=[{id:101,text:'More choices',type:'single_choice',answers:Array.from({length:28},(_,i)=>({id:700+i,text:'Option '+i}))}];
 const quiz=normalise(many);assert.equal(quiz.questions[0].options[26].id,'AA');assert.equal(quiz.questions[0].options[27].id,'AB');assert.deepEqual(mapLmsQuizAnswers(quiz,{'101':'AB'}),{'101':727});
});
test('invalid or empty public quiz payloads are rejected',()=>{
 for(const raw of [null,[],{}, {...fixture(),questions:[]}, {...fixture(),passingGrade:'70'}, {...fixture(),title:''}])assert.throws(()=>normalise(raw));
 assert.throws(()=>normaliseLmsQuiz(fixture(),{componentId:'../other'}));
});
test('changed version invalidates a draft',()=>{
 const raw=fixture();raw.version=1;const draft=createLmsQuizDraft(normalise(raw),{'101':'A'});raw.version=2;
 assert.equal(validateLmsQuizDraft(normalise(raw),draft).reason,'QUIZ_CHANGED');
});


test('a later fetch invalidates an older in-memory mapping for the same activity',()=>{
 const old=normalise(fixture()),raw=fixture();raw.questions[0].answers[0].id=999;
 const latest=normalise(raw);
 assert.throws(()=>mapLmsQuizAnswers(old,{'101':'A','102':['A']}),error=>error.code==='FRESH_QUIZ_REQUIRED');
 assert.deepEqual(mapLmsQuizAnswers(latest,{'101':'A','102':['A']}),{'101':999,'102':[602]});
});
