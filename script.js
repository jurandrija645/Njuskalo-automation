require("dotenv").config();
const puppeteer = require("puppeteer");

(async () => {
  // Get credentials from environment variables
  const username = process.env.NJUSKALO_USERNAME;
  const password = process.env.NJUSKALO_PASSWORD;

  if (!username || !password) {
    console.error("Error: Username or password not found in .env file");
    console.log(
      "Please create a .env file with NJUSKALO_USERNAME and NJUSKALO_PASSWORD"
    );
    process.exit(1);
  }

  // Launch browser with visible UI for debugging
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const page = await browser.newPage();

  // Login to Njuskalo
  await page.goto("https://www.njuskalo.hr/prijava", {
    waitUntil: "networkidle2",
  });

  // Handle cookie consent if it appears
  try {
    const cookieSelector =
      'button[data-testid="cookie-consent-accept-all"], .cookie-consent-accept-all, button:contains("Prihvati sve")';
    const cookieButton = await page.$(cookieSelector);
    if (cookieButton) {
      console.log("Accepting cookies...");
      await cookieButton.click();
      await page.waitForTimeout(1000); // Wait a bit after clicking
    }
  } catch (error) {
    console.log(
      "No cookie consent dialog found or error handling it:",
      error.message
    );
  }

  // Wait for login form to be visible
  try {
    await page.waitForSelector(
      '#email, input[name="email"], input[type="email"]',
      { timeout: 5000 }
    );

    // Add login credentials - using multiple possible selectors
    const emailSelector = '#email, input[name="email"], input[type="email"]';
    const passwordSelector =
      '#password, input[name="password"], input[type="password"]';
    const submitSelector =
      'button[type="submit"], input[type="submit"], .prijavi-se';

    await page.type(emailSelector, username);
    await page.type(passwordSelector, password);
    await page.click(submitSelector);

    // Wait for login to complete
    await page.waitForNavigation({ waitUntil: "networkidle2" });
  } catch (error) {
    console.error("Error during login:", error.message);

    // Take a screenshot to see what's on the page
    await page.screenshot({ path: "login-page-error.png" });
    console.log("Screenshot saved as login-page-error.png");

    // Print the current URL
    console.log("Current URL:", await page.url());

    // Check for CAPTCHA
    const pageContent = await page.content();
    if (
      pageContent.includes("CAPTCHA") ||
      pageContent.includes("Riješi CAPTCHA-u")
    ) {
      console.log(
        "CAPTCHA detected! Please solve it manually and press Enter in the console to continue..."
      );
      await new Promise((resolve) => {
        process.stdin.once("data", (data) => {
          resolve();
        });
      });

      // Try login again after CAPTCHA
      await page.goto("https://www.njuskalo.hr/prijava", {
        waitUntil: "networkidle2",
      });
      await page.waitForSelector(
        '#email, input[name="email"], input[type="email"]',
        { timeout: 5000 }
      );
      await page.type(emailSelector, username);
      await page.type(passwordSelector, password);
      await page.click(submitSelector);
      await page.waitForNavigation({ waitUntil: "networkidle2" });
    }
  }

  // Navigate to active listings page
  await page.goto(
    "https://www.njuskalo.hr/moje-njuskalo/privatni/moji-oglasi/aktivni-oglasi",
    {
      waitUntil: "networkidle2",
    }
  );

  // Check for CAPTCHA and pause if detected
  const captchaCheck = async () => {
    const captchaExists = await page.evaluate(() => {
      return (
        document.body.innerText.includes("Riješi CAPTCHA-u") ||
        document.body.innerText.includes("Solve the CAPTCHA")
      );
    });

    if (captchaExists) {
      console.log(
        "CAPTCHA detected! Please solve it manually and press Enter in the console to continue..."
      );
      // This will pause the script until you press Enter in the console
      await new Promise((resolve) => {
        process.stdin.once("data", (data) => {
          resolve();
        });
      });
    }
  };

  await captchaCheck();

  // Loop through all listings
  let listingsProcessed = 0;
  let continueScraping = true;

  while (continueScraping) {
    // Get all the "SKOK NA VRH" or "BESPLATNO SKOČI" buttons
    const jumpButtons = await page.$$eval(
      'a.skok-button, button.skok-button, a:contains("SKOK NA VRH"), button:contains("BESPLATNO SKOČI")',
      (buttons) =>
        buttons.map((button) => {
          // Extract the listing ID from the button or its parent element
          const href = button.href || button.closest("a")?.href || "";
          const adId = href.match(/ad_id=(\d+)/)
            ? href.match(/ad_id=(\d+)/)[1]
            : "";
          return { adId, href };
        })
    );

    if (jumpButtons.length === 0 || listingsProcessed >= jumpButtons.length) {
      console.log("No more listings to process.");
      continueScraping = false;
      break;
    }

    // Process the next listing
    const currentButton = jumpButtons[listingsProcessed];
    console.log(
      `Processing listing ${listingsProcessed + 1} with ID: ${
        currentButton.adId
      }`
    );

    // Click on the "SKOK NA VRH" or "BESPLATNO SKOČI" button
    if (currentButton.href) {
      await page.goto(currentButton.href, { waitUntil: "networkidle2" });
    } else {
      // If we couldn't get the href, try clicking directly
      try {
        const buttonSelectors = [
          'a:contains("SKOK NA VRH")',
          'button:contains("BESPLATNO SKOČI")',
          ".skok-button",
          ".besplatno-skoci",
        ];

        for (const selector of buttonSelectors) {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            break;
          }
        }

        await page.waitForNavigation({ waitUntil: "networkidle2" });
      } catch (error) {
        console.error("Error clicking the button:", error);
      }
    }

    // Check for CAPTCHA after navigation
    await captchaCheck();

    // On the next page, find and click the "Izvrši" button
    try {
      await page.waitForSelector(
        'button:contains("IZVRŠI"), .izvrsi-button, button.btn-primary',
        { timeout: 5000 }
      );
      await page.click(
        'button:contains("IZVRŠI"), .izvrsi-button, button.btn-primary'
      );
      await page.waitForNavigation({ waitUntil: "networkidle2" });

      // Check for CAPTCHA after clicking "Izvrši"
      await captchaCheck();

      console.log(`Successfully updated listing ${listingsProcessed + 1}`);
    } catch (error) {
      console.error("Error clicking the Izvrši button:", error);
    }

    // Go back to the listings page for the next iteration
    await page.goto(
      "https://www.njuskalo.hr/moje-njuskalo/privatni/moji-oglasi/aktivni-oglasi",
      {
        waitUntil: "networkidle2",
      }
    );

    // Check for CAPTCHA after returning to the listings page
    await captchaCheck();

    // Increment the counter
    listingsProcessed++;

    // Add a small delay between operations to avoid triggering anti-bot measures
    await page.waitForTimeout(2000);
  }

  console.log(`Finished processing ${listingsProcessed} listings.`);

  // Keep the browser open for verification (you can close it manually)
  // await browser.close();
})();
