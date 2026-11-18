/*
 * Supabase 연결 설정
 * 비워두면 로그인 없이 브라우저 localStorage에만 저장됩니다.
 * 값을 채우면 회원가입·로그인·친구 공유를 쓸 수 있습니다 (먼저 supabase/schema.sql 실행).
 */
window.BM_CONFIG = {
  SUPABASE_URL: 'https://jjjgnghdftetfqnhahci.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_6LSNSaF_-7GgW7XHwkjvHw_qFEAtR3z', // publishable(anon) key — 공개돼도 되는 키
  // 로그인은 아이디로 합니다. Supabase에는 내부적으로 "아이디@LOGIN_DOMAIN"으로 저장되며 메일은 보내지 않습니다.
  // 이미 가입한 회원이 있을 때 바꾸면 그 회원은 로그인할 수 없게 되니 바꾸지 마세요.
  LOGIN_DOMAIN: 'bandmanager.app',
};
