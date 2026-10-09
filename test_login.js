async function testLogin() {
  const res = await fetch('http://localhost:4000/api/auth/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'gaurav.kr.singh@hotmail.com', password: 'adminpassword123' }),
  });
  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}
testLogin();
