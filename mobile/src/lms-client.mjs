// Native client for the existing LMS login and the prepared same-host mobile adapter.
// The platform cookie jar owns the HttpOnly session. Never persist a password here.
export const LMS_ORIGIN = 'https://lms.kentbusinesscollege.org';
export const LMS_MOBILE_BASE = '/learner_api/mobile/';
export class LmsServiceError extends Error {
  constructor(message, status = 0, code = 'LMS_REQUEST_FAILED') { super(message); this.name = 'LmsServiceError'; this.status = status; this.code = code; }
}
const componentId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)) throw new LmsServiceError('This learning activity has no valid LMS ID.', 400, 'INVALID_COMPONENT');
  return encodeURIComponent(value);
};
const validIdentity = value => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9][0-9]*$/.test(value));
function checkedMobileSession(result, expectedAccountId) {
  if (result?.authenticated !== true || !result.user || !validIdentity(result.user.id) || !validIdentity(result.user.accountId)) {
    throw new LmsServiceError('The LMS did not confirm a valid learner session.', 502, 'INVALID_SESSION_RESPONSE');
  }
  if (expectedAccountId !== undefined && String(result.user.accountId) !== String(expectedAccountId)) {
    throw new LmsServiceError('The learner session changed. Please sign in again.', 409, 'SESSION_CHANGED');
  }
  return result;
}
const identityFields = ['learnerId','learner_id','enrolmentId','profileId','accountId','userId','accepted','points','score'];
function ownPayload(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LmsServiceError('The request is not valid.', 400);
  if (identityFields.some(key => Object.hasOwn(value, key))) throw new LmsServiceError('The LMS must determine identity, marks and accepted hours.', 400, 'SERVER_OWNED_FIELD');
  return value;
}
export function createLmsClient({fetchImpl = globalThis.fetch, timeoutMs = 30000, onSessionExpired = () => {}, communications = false} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A native HTTPS fetch implementation is required.');
  let generation = 0;
  async function request(path, method = 'GET', body, {mobile = true, sessionSensitive = true} = {}) {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_\-/%.:]+(?:\?(?:moduleId=[A-Za-z0-9_%.:-]+|before=[0-9]+))?$/.test(path) || path.includes('..') || path.includes('//')) throw new LmsServiceError('The LMS request address is not valid.', 400);
    const url = new URL(path, LMS_ORIGIN);
    if (url.origin !== LMS_ORIGIN || (!url.pathname.startsWith(LMS_MOBILE_BASE) && !url.pathname.startsWith('/learner_api/communications/') && !['/login_api/login/','/login_api/logout/','/login_api/me/'].includes(url.pathname))) throw new LmsServiceError('This destination is not an LMS service.', 400);
    const requestGeneration = generation, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {method, credentials:'include', redirect:'error', cache:'no-store', signal:controller.signal, headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest',...(body === undefined ? {} : {'Content-Type':'application/json'})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      if (sessionSensitive && requestGeneration !== generation) throw new LmsServiceError('The learner session changed. Refresh your learning page.', 409, 'SESSION_CHANGED');
      if (response.status === 401) { generation++; onSessionExpired(); throw new LmsServiceError('Please sign in to your LMS account again.', 401, 'AUTH_REQUIRED'); }
      const contentType = response.headers?.get?.('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) throw new LmsServiceError(mobile ? 'The mobile connection has not been activated on the LMS yet.' : 'The LMS did not return a valid sign-in response.', response.status, 'INTEGRATION_UNAVAILABLE');
      const result = await response.json();
      if (sessionSensitive && requestGeneration !== generation) throw new LmsServiceError('The learner session changed. Refresh your learning page.', 409, 'SESSION_CHANGED');
      if (!response.ok) {
        if (mobile && [404,503].includes(response.status) && (!result?.code || result.code === 'mobile_disabled')) throw new LmsServiceError('The mobile connection has not been activated on the LMS yet.', response.status, 'INTEGRATION_UNAVAILABLE');
        const detail = typeof result?.error === 'string' ? result.error : typeof result?.detail === 'string' ? result.detail : 'The LMS could not save this request. Please try again.';
        throw new LmsServiceError(detail.slice(0,500), response.status, typeof result?.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(result.code) ? result.code : 'LMS_REQUEST_FAILED');
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new LmsServiceError('The LMS connection timed out. Check your saved progress before retrying a submission.', 0, 'TIMEOUT');
      if (error instanceof LmsServiceError) throw error;
      throw new LmsServiceError('The LMS could not be reached. Check your connection and try again.', 0, 'NETWORK');
    } finally { clearTimeout(timeout); }
  }
  const mobile = (path, method, body) => request(LMS_MOBILE_BASE + path, method, body);
  const comms = (path, method, body) => request('/learner_api/communications/' + path, method, body, {mobile:false});
  async function session(expectedAccountId) {
    if (!communications) return checkedMobileSession(await mobile('session/'), expectedAccountId);
    const profile = await comms('session/');
    if (!validIdentity(profile.accountId) || !['coach','learner'].includes(profile.role)
        || (expectedAccountId!==undefined && String(expectedAccountId)!==String(profile.accountId))) {
      throw new LmsServiceError('The account changed. Please sign in again.',409,'SESSION_CHANGED');
    }
    if (profile.role==='coach') return {authenticated:true,user:{id:profile.accountId,accountId:profile.accountId,learnerKind:'coach'},communications:profile};
    return {...checkedMobileSession(await mobile('session/'),profile.accountId),communications:profile};
  }
  return {
    origin:LMS_ORIGIN,
    comms,
    async signIn(email,password) {
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) throw new LmsServiceError('Enter your LMS email address and password.',400);
      generation++;
      const login = await request('/login_api/login/','POST',{email:email.trim(),password,remember:true},{mobile:false});
      if (login?.passwordSetupRequired === true) {
        throw new LmsServiceError('Set your LMS password on the LMS website, then return here to sign in.', 409, 'PASSWORD_SETUP_REQUIRED');
      }
      if (!login?.user || !validIdentity(login.user.id)) {
        throw new LmsServiceError('The LMS did not confirm your sign-in. Please try again.', 502, 'INVALID_LOGIN_RESPONSE');
      }
      // Login alone does not prove installation, learner authorisation or that
      // the native cookie jar still contains this same account's session.
      return session(login.user.id);
    },
    session:() => session(),
    async signOut() { generation++; return request('/login_api/logout/','POST',{}, {mobile:false,sessionSensitive:false}); },
    catalogue:() => mobile('catalogue/'),
    progress:moduleId => mobile('progress/'+(moduleId===undefined?'':'?moduleId='+componentId(moduleId))),
    hours:moduleId => mobile('hours/'+(moduleId===undefined?'':'?moduleId='+componentId(moduleId))),
    points:() => mobile('points/'),
    rewardsSummary:() => mobile('rewards/summary/'),
    recordObservations:body => mobile('rewards/observations/','POST',ownPayload(body)),
    requestVoucher:body => mobile('rewards/voucher-requests/','POST',ownPayload(body)),
    setLeaderboard:body => mobile('rewards/leaderboard/','POST',ownPayload(body)),
    meetings:() => mobile('meetings/'),
    quiz:id => mobile('quizzes/'+componentId(id)+'/'),
    transcript:id => mobile('components/'+componentId(id)+'/transcript/'),
    startLearning(id,mode) {
      if (!['audio','video','quiz'].includes(mode)) throw new LmsServiceError('Select a supported learning activity.',400);
      return mobile('learning-sessions/start/','POST',{componentId:decodeURIComponent(componentId(id)),mode});
    },
    submitQuiz:(id,body) => mobile('quizzes/'+componentId(id)+'/submit/','POST',ownPayload(body)),
    completeActivity:(id,body,{video=false}={}) => mobile((video?'videos/':'components/')+componentId(id)+'/complete/','POST',ownPayload(body)),
    bookMeeting:body => mobile('meetings/book/','POST',ownPayload(body)),
    rescheduleMeeting:body => mobile('meetings/reschedule/','POST',ownPayload(body)),
    cancelMeeting:body => mobile('meetings/cancel/','POST',ownPayload(body)),
  };
}
