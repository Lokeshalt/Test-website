const fs = require("fs");
const https = require("https");

const url = "YOUR_CSV_LINK";

https.get(url, (res) => {
  let data = "";

  res.on("data", chunk => data += chunk);

  res.on("end", () => {
    const rows = data.split("\n").slice(1);

    const json = rows.map(row => {
      const [seat, status] = row.split(",");
      return {
        seat: Number(seat),
        status: status.trim()
      };
    });

    fs.writeFileSync("occupancy.json", JSON.stringify(json, null, 2));
    console.log("Updated occupancy.json");
  });
});