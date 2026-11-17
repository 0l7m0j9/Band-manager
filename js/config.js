/*
 * Supabase 연결 설정
 * 비워두면 브라우저 localStorage에만 저장됩니다.
 * 값을 채우면 supabase/schema.sql 로 만든 app_state 테이블에 자동 동기화됩니다.
 */
window.BM_CONFIG = {
  SUPABASE_URL: '',       // 예: 'https://xxxx.supabase.co'
  SUPABASE_ANON_KEY: '',  // 프로젝트 Settings > API 의 anon public key
  WORKSPACE_ID: 'default' // 같은 ID를 쓰는 브라우저끼리 데이터를 공유
};
