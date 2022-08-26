const puppeteer = require("puppeteer");
const fs = require("fs");
const https = require("https");
const axios = require("axios");
const uuidv4 = require("uuid")["v4"];
const xml2js = require("xml2js");

let argv = process.argv;
const outputFileName = argv[2];

if (!outputFileName) {
	throw Error("urza_scraper [filename] [setname]");
}
const setName = argv[3];
if (!setName) {
	setName = "customSet";
}
var cardsArray = [];
let oneSession = async (page, name, rej) => {
	var card = {};

	await page.goto("https://www.urzas.ai/", {
		timeout: 0,
		waitUntil: "networkidle0",
	});
	const bodyHandle = await page.$("body");

	const dataId = await page.evaluate(
		() => document.getElementById("app").getAttributeNames()[0]
	);

	await page.waitForSelector(`input[${dataId}]`, { timeout: 300000 });
	await page.focus(`input[${dataId}]`);
	await page.keyboard.type(name);

	page.on("response", (response) => {
		if (
			response
				.url()
				.startsWith(
					"https://backend-dot-valued-sight-253418.ew.r.appspot.com/api/v1/art?"
				)
		) {
			response.json().then((res) => {
				card = res;
			});
		} else if (response.status() == 500) {
			console.log("DIRTY NAME FOUND REPLACE: ", name);
			page.close();
			rej(0);
		}

		// do something here
	});

	await page.click('div[id="action-button"]');

	await page.waitForSelector('img[id="card-image"]', { timeout: 300000 });

	await page.waitForSelector('img[id="card-image"][src]', { timeout: 60000 });
	const base64Img = await page.$eval(
		'img[id="card-image"][src]',
		(img) => img.src
	);

	await page.waitForTimeout(10000);

	const imgData = await page.$eval(
		'img[id="card-image"][src]',
		(img) => img.src
	);

	card.url = imgData;
	var base64Data = base64Img.replace(/^data:image\/png;base64,/, "");

	fs.writeFile(`./images/${name}.png`, base64Data, "base64", function (err) {
		if (err) throw err;
	});
	cardsArray.push(card);
	page.close();
	return true;
};

(async () => {
	const browser = await puppeteer.launch();
	const promises = [];

	const data = fs.readFileSync("./names.txt", { encoding: "utf8", flag: "r" });
	let names = data.split(/\r?\n/);
	for (const name of names) {
		const page = await browser.newPage();
		promises.push(
			new Promise((res, rej) =>
				oneSession(page, name, rej)
					.then((e) => {
						if (e == 0) {
							console.log("REJECTION: ", e);
							rej(e);
						} else {
							res(e);
						}
					})
					.catch((e) => {
						rej();
						console.log("MISSED", e);
					})
			).catch((e) => console.log(e))
		);
	}
	Promise.all(promises).then(() => {
		browser.close();
		setCreator(cardsArray, outputFileName);
	});
})();

const setCreator = (objs, outputFileName) => {
	let writeStream = fs.createWriteStream(`./100.${outputFileName}.xml`);
	writeStream.on("error", console.error);
	var xmlObj = {
		cockatrice_carddatabase: {
			$: {
				version: "4",
			},
			sets: {
				set: {
					name: `${setName}`,
					longname: `${setName}`,
					settype: "custom",
					releasedate: (() => {
						let date_ob = new Date();
						let date = ("0" + date_ob.getDate()).slice(-2);
						let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
						let year = date_ob.getFullYear();
						return year + "-" + month + "-" + date;
					})(),
				},
			},
			cards: [],
		},
	};
	for (card of cardsArray) {
		let output = { card: cardCreator(card, setName) };
		xmlObj.cockatrice_carddatabase.cards.push(output);
	}
	var builder = new xml2js.Builder();
	var xml = builder.buildObject(xmlObj);

	writeStream.write(xml);
	writeStream.close();
};

const cardCreator = (c, setName) => {
	card = {};
	card.name = c.name;
	card.text = c.text + "\n" + c.flavorText;
	card.set = {
		$: { picurl: c.url, uuid: uuidv4(), rarity: c.rarity },
		_: setName,
	};
	//UPDATE
	card.tablerow = 3;
	let prop = {
		maintype: c.types,
		type: c.types + " — " + c.subtypes,
		manacost: c.manaCost.replace(/\W/g, ""),
		type: c.subtypes,
		colors: c.manaCost.replace(/[^a-z]/gi, ""),
	};
	if (c.toughness || c.strength) {
		card.ct = `${c.strength ? c.strength : 0}/${c.toughness ? c.toughness : 0}`;
	}
	card.prop = prop;
	return card;
};
