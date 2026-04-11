exports.handler = async function() {
  const res = await fetch("https://qwroundtree-ouraauth.web.val.run/data");
  const data = await res.json();
  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(data),
  };
};