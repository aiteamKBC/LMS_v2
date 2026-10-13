/** Quiz interaction and validation. Answer keys belong on the server only. */
export function selectionMode(question) {
 return question?.selectionMode === 'multiple' || (Array.isArray(question?.correctOptionIds) && question.correctOptionIds.length > 1) ? 'multiple' : 'single';
}
function optionIds(question) {
 const options=question?.options;
 if(!Array.isArray(options)||options.length<2)throw new Error('A question needs at least two options.');
 const ids=options.map(o=>o?.id);
 if(ids.some(id=>typeof id!=='string'||!/^[A-Z]+$/.test(id))||new Set(ids).size!==ids.length)throw new Error('Question options must have distinct letter identifiers.');
 return ids;
}
export function normaliseAnswer(question,value) {
 const ids=optionIds(question),multi=selectionMode(question)==='multiple';
 const selected=typeof value==='string'?[value]:Array.isArray(value)?value:null;
 if(!selected||!selected.length||(!multi&&selected.length!==1)||selected.some(id=>typeof id!=='string'||!ids.includes(id))||new Set(selected).size!==selected.length)throw new Error('Choose valid, distinct options for every question.');
 const ordered=ids.filter(id=>selected.includes(id));
 return multi?ordered:ordered[0];
}
export function answerIds(value) { return typeof value==='string'?[value]:Array.isArray(value)?value:[]; }
export function hasAnswer(question,value) { try{normaliseAnswer(question,value);return true;}catch{return false;} }
export function toggleAnswer(question,value,optionId) {
 const ids=optionIds(question);if(!ids.includes(optionId))throw new Error('Unknown option.');
 if(selectionMode(question)==='single')return optionId;
 const prior=answerIds(value),selected=prior.includes(optionId)?prior.filter(id=>id!==optionId):[...prior,optionId];
 return ids.filter(id=>selected.includes(id));
}
export function correctAnswerIds(question) {
 const raw=question.correctOptionIds??(question.correctOptionId===undefined?undefined:[question.correctOptionId]);
 if(!Array.isArray(raw))throw new Error('The question answer key is unavailable.');
 return answerIds(normaliseAnswer(question,raw));
}
export function normaliseAnswers(questions,answers) {
 if(!answers||typeof answers!=='object'||Array.isArray(answers)||!Array.isArray(questions)||!questions.length)throw new Error('Answer all quiz questions before submitting.');
 const ids=questions.map(q=>q.id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||Object.keys(answers).length!==ids.length||Object.keys(answers).some(id=>!ids.includes(id)))throw new Error('This answer set does not match the quiz.');
 return Object.fromEntries(questions.map(q=>[q.id,normaliseAnswer(q,answers[q.id])]));
}
export function gradeQuiz(questions,answers) {
 const normalised=normaliseAnswers(questions,answers);
 const feedback=questions.map(q=>{
  const correctOptionIds=correctAnswerIds(q),actual=answerIds(normalised[q.id]);
  return {questionId:q.id,correct:actual.length===correctOptionIds.length&&actual.every((id,i)=>id===correctOptionIds[i]),correctOptionIds,...(correctOptionIds.length===1?{correctOptionId:correctOptionIds[0]}:{}),explanation:q.explanation||'',ksbs:q.ksbs||[]};
 });
 return {answers:normalised,correct:feedback.filter(f=>f.correct).length,totalQuestions:questions.length,feedback};
}
export function sameAnswers(questions,left,right) {
 try{return JSON.stringify(normaliseAnswers(questions,left))===JSON.stringify(normaliseAnswers(questions,right));}catch{return false;}
}
export function publicQuestion(question) {
 optionIds(question);
 return {id:question.id,prompt:question.prompt,options:question.options.map(o=>({id:o.id,text:o.text})),selectionMode:selectionMode(question),ksbs:question.ksbs||[]};
}
/** Explicit option labels only; never infer answers from prose, negation or an "or" alternative. */
export function parseQuizVoice(text,question) {
 if(typeof text!=='string')return [];
 const cleaned=text.trim().toUpperCase().replace(/[.!?]$/,'').replace(/^(?:(?:THE )?ANSWERS? (?:IS|ARE) |OPTIONS? |ANSWERS? |SELECT |CHOOSE )/,'');
 if(!/^[A-Z]+(?:(?:\s*,\s*(?:AND\s+)?|\s+AND\s+|\s*&\s*)[A-Z]+)*$/.test(cleaned))return [];
 // Extract option tokens, never the A/D in the separator word AND.
 const selected=cleaned.split(/\s*,\s*(?:AND\s+)?|\s+AND\s+|\s*&\s*/);
 try{return answerIds(normaliseAnswer(question,selected));}catch{return [];}
}
export function restoreQuizDraft(raw,activityId,now=Date.now()) {
 if(!raw)return null;
 try{
  const saved=JSON.parse(raw),source=saved.attempt,started=Date.parse(source?.startedAt),age=now-started;
  if(saved.version!==1||typeof source?.attemptId!=='string'||!Number.isFinite(age)||age< -60000||age>=24*3600000||source.quiz?.id!==activityId||!Array.isArray(source.quiz.questions)||!source.quiz.questions.length)return null;
  const questions=source.quiz.questions.map(publicQuestion);
  if(questions.some(q=>typeof q.id!=='string'||typeof q.prompt!=='string'||q.options.some(o=>typeof o.text!=='string'))||new Set(questions.map(q=>q.id)).size!==questions.length)return null;
  const answers=Object.fromEntries(questions.filter(q=>hasAnswer(q,saved.answers?.[q.id])).map(q=>[q.id,normaliseAnswer(q,saved.answers[q.id])]));
  const passMark=source.quiz.passMark??source.quiz.passPercent;
  return {version:1,attempt:{attemptId:source.attemptId,startedAt:source.startedAt,quiz:{id:activityId,title:source.quiz.title||'',...(Number.isFinite(passMark)?{passMark}:{}),questions}},answers,index:Math.max(0,Math.min(questions.length-1,Number.isInteger(saved.index)?saved.index:0))};
 }catch{return null;}
}
