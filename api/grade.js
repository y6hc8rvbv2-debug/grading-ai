export default async function handler(req, res) {

const response = await fetch(
"https://api.openai.com/v1/chat/completions",
{
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization":
`Bearer ${process.env.OPENAI_API_KEY}`
},
body: JSON.stringify({
model: "gpt-5.5",
messages: [
{
role: "system",
content:
"あなたは小学生テスト採点AIです。"
},
{
role: "user",
content:
"小学生テストを採点してください。今回はテストとして80点を返してください。"
}
]
})
}
);

const data = await response.json();

res.status(200).json({
score: 80,
comment: "よくできました！"
});

}
