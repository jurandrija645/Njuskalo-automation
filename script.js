require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

// Cookie handling functions
const saveCookies = async (page) => {
  const cookies = await page.cookies();
  fs.writeFileSync("./cookies.json", JSON.stringify(cookies, null, 2));
  console.log("Cookies saved for future sessions");
};

const loadCookies = async (page) => {
  try {
    const cookiesString = fs.readFileSync("./cookies.json", "utf8");
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    console.log("Previous session cookies loaded");
    return true;
  } catch (error) {
    console.log("No saved cookies found or error loading them");
    return false;
  }
};

// Add this function at the top of your script, after the cookie functions
const safeNavigate = async (page, url, options = {}) => {
  try {
    // Set default timeout to 60 seconds if not specified
    const navigateOptions = {
      waitUntil: "networkidle2",
      timeout: 60000,
      ...options,
    };

    console.log(`Navigating to: ${url}`);
    await page.goto(url, navigateOptions);
    console.log(`Successfully navigated to: ${url}`);
    return true;
  } catch (error) {
    console.error(`Navigation error for ${url}: ${error.message}`);

    // Take a screenshot to see what happened
    const screenshotPath = `navigation-error-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved as ${screenshotPath}`);

    // Check if we're on a 2FA page despite the error
    const is2FARequired = await page.evaluate(() => {
      return (
        document.body.innerText.includes("dvofaktorska autentikacija") ||
        document.body.innerText.includes("two-factor authentication") ||
        document.body.innerText.includes("kod") ||
        document.querySelector('input[type="text"][name*="code"]') !== null
      );
    });

    if (is2FARequired) {
      console.log("Two-factor authentication detected during navigation!");
      return "2FA";
    }

    return false;
  }
};

// Helper function for waiting
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Main function
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

  // Add this near the beginning of your script, after creating the page
  page.on("console", (msg) => {
    // Optionally log browser console messages for debugging
    // console.log('BROWSER CONSOLE:', msg.text());
  });

  page.on("pageerror", (err) => {
    // Log JavaScript errors but don't let them stop our script
    console.log("BROWSER JS ERROR:", err.message);
  });

  // Also add this to ignore dialog boxes (alerts, confirms, prompts)
  page.on("dialog", async (dialog) => {
    console.log("BROWSER DIALOG:", dialog.message());
    await dialog.dismiss();
  });

  // First try to use saved cookies
  let isLoggedIn = false;
  const hasCookies = await loadCookies(page);

  if (hasCookies) {
    // Try going directly to the listings page
    try {
      await page.goto(
        "https://www.njuskalo.hr/moje-njuskalo/privatni/moji-oglasi/aktivni-oglasi",
        {
          waitUntil: "networkidle2",
          timeout: 60000,
        }
      );

      // Check if we're still logged in
      isLoggedIn = await page.evaluate(() => {
        return (
          !document.body.innerText.includes("Prijava") &&
          !document.body.innerText.includes("Login")
        );
      });

      if (isLoggedIn) {
        console.log("Successfully logged in using saved cookies");
      } else {
        console.log("Saved cookies expired, proceeding with normal login");
      }
    } catch (error) {
      console.log("Error checking cookie login:", error.message);
      isLoggedIn = false;
    }
  }

  // If not logged in with cookies, proceed with normal login
  if (!isLoggedIn) {
    // Login to Njuskalo with increased timeout
    try {
      await page.goto("https://www.njuskalo.hr/prijava", {
        waitUntil: "networkidle2",
        timeout: 60000, // Increase timeout to 60 seconds
      });
    } catch (error) {
      console.error("Error loading login page:", error.message);
      await page.screenshot({ path: "page-load-error.png" });
      console.log("Current URL:", await page.url());
    }

    // Handle cookie consent if it appears
    try {
      console.log("Checking for cookie consent dialog...");
      await wait(5000);

      // Try multiple approaches to find and click the button
      const cookieButtonClicked = await page.evaluate(() => {
        // Look for buttons with specific text
        const buttonTexts = ["Prihvati i zatvori", "Prihvati sve"];

        for (const text of buttonTexts) {
          const buttons = Array.from(document.querySelectorAll("button"));
          for (const button of buttons) {
            if (
              button.textContent.trim() === text ||
              button.textContent.includes(text)
            ) {
              button.click();
              return true;
            }
          }
        }

        // Try common selectors
        const selectors = [
          ".prihvati-i-zatvori",
          "#onetrust-accept-btn-handler",
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            element.click();
            return true;
          }
        }

        return false;
      });

      if (cookieButtonClicked) {
        console.log("Cookie consent button clicked");
        await wait(3000);
      }
    } catch (error) {
      console.log("Error handling cookie consent:", error.message);
    }

    // Login with credentials
    try {
      await page.waitForSelector(
        '#login_username, input[name="login[username]"]',
        {
          timeout: 5000,
        }
      );

      console.log("Login form found, entering credentials...");

      const emailInput = await page.$(
        '#login_username, input[name="login[username]"]'
      );
      const passwordInput = await page.$(
        '#login_password, input[name="login[password]"]'
      );

      if (emailInput && passwordInput) {
        await emailInput.type(username);
        await passwordInput.type(password);

        const submitButton = await page.$(
          'button[type="submit"], input[type="submit"], .prijavi-se'
        );
        if (submitButton) {
          console.log("Clicking submit button...");
          await submitButton.click();
          await page.waitForNavigation({ waitUntil: "networkidle2" });
          console.log("Login form submitted!");
        }
      }
    } catch (error) {
      console.error("Error during login:", error.message);
      await page.screenshot({ path: "login-page-error.png" });
    }

    // Handle 2FA if needed
    try {
      // Check if 2FA page is present with more specific detection
      const is2FARequired = await page.evaluate(() => {
        return (
          document.body.innerText.includes("Unesi sigurnosni kod") ||
          document.body.innerText.includes("dvofaktorskom autentifikacijom") ||
          document.querySelector('input[placeholder*="kod"]') !== null
        );
      });

      if (is2FARequired) {
        console.log("\n\n");
        console.log(
          "*********************************************************"
        );
        console.log(
          "*                                                       *"
        );
        console.log(
          "*  TWO-FACTOR AUTHENTICATION REQUIRED!                  *"
        );
        console.log(
          "*  Please check your email for the verification code    *"
        );
        console.log(
          "*                                                       *"
        );
        console.log(
          "*********************************************************"
        );
        console.log("\n");

        // Make a beep sound to get attention
        process.stdout.write("\x07");

        console.log(
          "ENTER THE 2FA CODE IN THIS TERMINAL (not in the browser):"
        );
        console.log("→ ");

        // Wait for user to input the 2FA code
        const code = await new Promise((resolve) => {
          process.stdin.once("data", (data) => {
            const inputCode = data.toString().trim();
            console.log(`\nYou entered: ${inputCode}\n`);
            resolve(inputCode);
          });
        });

        // Find and fill the 2FA input field
        const codeInput = await page.$('input[placeholder*="kod"]');
        if (codeInput) {
          await codeInput.type(code);
          console.log("Code entered successfully");

          // Find the submit button using more basic selectors
          const submitButton = await page.evaluate(() => {
            // Look for buttons with the text "POTVRDI KOD"
            const buttons = Array.from(document.querySelectorAll("button"));
            const confirmButton = buttons.find(
              (button) =>
                button.textContent.trim() === "POTVRDI KOD" ||
                button.innerText.includes("POTVRDI KOD")
            );

            if (confirmButton) {
              // Return the button's position for clicking outside evaluate
              const rect = confirmButton.getBoundingClientRect();
              return {
                found: true,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
              };
            }

            return { found: false };
          });

          if (submitButton.found) {
            console.log("Found POTVRDI KOD button, clicking...");
            // Click at the coordinates
            await page.mouse.click(submitButton.x, submitButton.y);
            await page.waitForNavigation({
              waitUntil: "networkidle2",
              timeout: 60000,
            });
            console.log("2FA verification successful!");

            // Save cookies after successful 2FA
            await saveCookies(page);
          } else {
            console.log(
              "POTVRDI KOD button not found, trying alternative methods..."
            );

            // Try clicking any button that looks like a submit button
            const anySubmitButton = await page.evaluate(() => {
              // Try to find the blue button which is likely the submit button
              const blueButtons = Array.from(
                document.querySelectorAll("button")
              ).filter((b) => {
                const style = window.getComputedStyle(b);
                return (
                  style.backgroundColor.includes("rgb(0, 150") || // Blue-ish color
                  b.classList.contains("btn-primary") ||
                  b.classList.contains("potvrdi")
                );
              });

              if (blueButtons.length > 0) {
                const button = blueButtons[0];
                const rect = button.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                };
              }

              return { found: false };
            });

            if (anySubmitButton.found) {
              console.log("Found a submit button, clicking...");
              await page.mouse.click(anySubmitButton.x, anySubmitButton.y);
              await page.waitForNavigation({
                waitUntil: "networkidle2",
                timeout: 60000,
              });
              console.log("Button clicked, waiting for navigation...");

              // Save cookies after successful 2FA
              await saveCookies(page);
            } else {
              console.error("No submit button found");
              await page.screenshot({ path: "no-submit-button.png" });
            }
          }
        } else {
          console.error("Code input field not found");
          await page.screenshot({ path: "2fa-input-not-found.png" });
        }
      } else {
        // If no 2FA was required, save cookies anyway
        await saveCookies(page);
      }
    } catch (error) {
      console.error("Error handling 2FA:", error.message);
      await page.screenshot({ path: "2fa-error.png" });
    }
  }

  // Add this right after the cookie login attempt
  // Check if we're on a 2FA page regardless of cookie status
  const currentUrl = await page.url();
  if (currentUrl.includes("2fa-enter-code")) {
    console.log("\n\n");
    console.log("*********************************************************");
    console.log("*                                                       *");
    console.log("*  TWO-FACTOR AUTHENTICATION REQUIRED!                  *");
    console.log("*  Please check your email for the verification code    *");
    console.log("*                                                       *");
    console.log("*********************************************************");
    console.log("\n");

    // Make a beep sound to get attention
    process.stdout.write("\x07");

    console.log("ENTER THE 2FA CODE IN THIS TERMINAL (not in the browser):");
    console.log("→ ");

    // Wait for user to input the 2FA code
    const code = await new Promise((resolve) => {
      process.stdin.once("data", (data) => {
        const inputCode = data.toString().trim();
        console.log(`\nYou entered: ${inputCode}\n`);
        resolve(inputCode);
      });
    });

    // Find and fill the 2FA input field
    const codeInput = await page.$('input[placeholder*="kod"]');
    if (codeInput) {
      await codeInput.type(code);
      console.log("Code entered successfully");

      // Click the submit button
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ timeout: 60000 });
      console.log("2FA verification submitted");

      // Save cookies after successful 2FA
      await saveCookies(page);
    }
  }

  // Replace the navigation to listings page with this more robust version
  try {
    console.log("Navigating to listings page...");

    // Use our safeNavigate function with a longer timeout
    const navResult = await safeNavigate(
      page,
      "https://www.njuskalo.hr/moje-njuskalo/privatni/moji-oglasi/aktivni-oglasi",
      { timeout: 120000 } // Increase to 2 minutes
    );

    if (navResult === true) {
      console.log("Successfully navigated to listings page");

      // Take a screenshot to verify
      await page.screenshot({ path: "listings-page-loaded.png" });

      // Wait a bit longer for all content to load
      await wait(10000);
    } else {
      console.log("Navigation to listings page failed or returned 2FA");

      // Try an alternative approach - wait for content instead of navigation
      try {
        // Just wait for some content that should be on the page
        await page.waitForSelector(".EntityList, .listing-items, .oglasi", {
          timeout: 30000,
        });
        console.log("Listings content detected on page");
      } catch (contentError) {
        console.error("Could not find listings content:", contentError.message);
      }
    }
  } catch (navError) {
    console.error("Error during navigation to listings:", navError.message);

    // Take a screenshot to see what happened
    await page.screenshot({ path: "navigation-error.png" });

    // Try to continue anyway
    console.log("Attempting to continue despite navigation error...");
  }

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
      await page.screenshot({ path: "captcha.png" });
      await new Promise((resolve) => {
        process.stdin.once("data", () => {
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
    // Wait for page to fully load using standard setTimeout
    await wait(5000);

    // Take a screenshot of the listings page to see what we're working with
    await page.screenshot({ path: "listings-page.png" });
    console.log("Screenshot saved as listings-page.png");

    // Log the page content for debugging
    console.log("Current page URL:", await page.url());
    console.log("Looking for jump buttons...");

    // Replace the jumpButtons code with this more comprehensive version
    const jumpButtons = await page.evaluate(() => {
      console.log("Evaluating page for jump buttons");

      // First, check if we're on the right page
      const isListingsPage =
        document.title.includes("Moji oglasi") ||
        document.body.innerText.includes("Moji oglasi") ||
        window.location.href.includes("moji-oglasi");

      if (!isListingsPage) {
        console.log("Not on the listings page!");
        return [];
      }

      // Get all buttons and links
      const allElements = Array.from(
        document.querySelectorAll("a, button, .btn, [role='button']")
      );
      console.log("Total interactive elements found:", allElements.length);

      // Try to find any elements that look like they might refresh or bump listings
      const possibleButtons = allElements.filter((el) => {
        const text = (el.textContent || "").trim().toUpperCase();
        const classes = Array.from(el.classList || [])
          .join(" ")
          .toUpperCase();
        const href = (el.href || "").toUpperCase();

        // Look for any text or class that suggests this is a bump/refresh button
        return (
          text.includes("SKOK") ||
          text.includes("OSVJEŽI") ||
          text.includes("REFRESH") ||
          text.includes("BUMP") ||
          text.includes("TOP") ||
          classes.includes("REFRESH") ||
          classes.includes("BUMP") ||
          classes.includes("SKOK") ||
          href.includes("REFRESH") ||
          href.includes("BUMP") ||
          href.includes("SKOK")
        );
      });

      console.log("Possible action buttons found:", possibleButtons.length);

      // If we didn't find any specific buttons, look for any buttons in listing items
      if (possibleButtons.length === 0) {
        // Try to find listing containers
        const listingContainers = Array.from(
          document.querySelectorAll(
            ".EntityList-item, .listing-item, .oglas, .ad-item"
          )
        );
        console.log("Listing containers found:", listingContainers.length);

        if (listingContainers.length > 0) {
          // For each listing, find buttons or links
          const buttonsInListings = listingContainers
            .map((container) => {
              const buttons = Array.from(
                container.querySelectorAll("a, button, .btn")
              );
              // Return the last button in each listing (often the action button)
              return buttons.length > 0 ? buttons[buttons.length - 1] : null;
            })
            .filter(Boolean);

          console.log("Buttons in listings found:", buttonsInListings.length);
          return buttonsInListings.map((button) => {
            return {
              element: button,
              href: button.href || "",
              text: button.textContent.trim(),
              rect: button.getBoundingClientRect(),
            };
          });
        }
      }

      // Return the buttons we found
      return possibleButtons.map((button) => {
        return {
          element: button,
          href: button.href || "",
          text: button.textContent.trim(),
          rect: button.getBoundingClientRect(),
        };
      });
    });

    // Log detailed information about what we found
    console.log("Jump buttons found:", jumpButtons.length);
    if (jumpButtons.length > 0) {
      console.log("Button details:");
      jumpButtons.forEach((btn, i) => {
        console.log(`Button ${i + 1}: Text="${btn.text}", Href=${btn.href}`);
      });

      // Take a screenshot with the first button highlighted
      if (jumpButtons[0].rect) {
        await page.evaluate((rect) => {
          const highlighter = document.createElement("div");
          highlighter.style.position = "absolute";
          highlighter.style.border = "2px solid red";
          highlighter.style.backgroundColor = "rgba(255, 0, 0, 0.2)";
          highlighter.style.zIndex = "10000";
          highlighter.style.left = rect.left + "px";
          highlighter.style.top = rect.top + "px";
          highlighter.style.width = rect.width + "px";
          highlighter.style.height = rect.height + "px";
          document.body.appendChild(highlighter);
        }, jumpButtons[0].rect);

        await page.screenshot({ path: "button-highlighted.png" });
        console.log("Screenshot saved with button highlighted");
      }
    }

    if (jumpButtons.length === 0 || listingsProcessed >= jumpButtons.length) {
      console.log("No more listings to process.");
      continueScraping = false;
      break;
    }

    // Process the next listing
    const currentButton = jumpButtons[listingsProcessed];
    console.log(
      `Processing listing ${listingsProcessed + 1} with ID: ${
        currentButton.adId || "unknown"
      }`
    );

    // Click on the "SKOK NA VRH" or "BESPLATNO SKOČI" button
    if (currentButton.href) {
      await page.goto(currentButton.href, { waitUntil: "networkidle2" });
    } else {
      // If we couldn't get the href, try clicking directly
      try {
        await page.evaluate((index) => {
          const buttons = Array.from(document.querySelectorAll("a, button"));
          const targetButtons = buttons.filter((el) => {
            const text = el.textContent.trim().toUpperCase();
            return (
              text.includes("SKOK NA VRH") || text.includes("BESPLATNO SKOČI")
            );
          });

          if (targetButtons[index]) {
            targetButtons[index].click();
          }
        }, listingsProcessed);

        await page.waitForNavigation({ waitUntil: "networkidle2" });
      } catch (error) {
        console.error("Error clicking the button:", error);
      }
    }

    // Check for CAPTCHA after navigation
    await captchaCheck();

    // On the next page, find and click the "Izvrši" button
    try {
      const executeButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const targetButton = buttons.find((el) =>
          el.textContent.trim().toUpperCase().includes("IZVRŠI")
        );
        if (targetButton) {
          targetButton.click();
          return true;
        }
        return false;
      });

      if (executeButton) {
        await page.waitForNavigation({ waitUntil: "networkidle2" });
        console.log(`Successfully updated listing ${listingsProcessed + 1}`);
      } else {
        console.error("Izvrši button not found");
      }

      // Check for CAPTCHA after clicking "Izvrši"
      await captchaCheck();
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
    await wait(2000);
  }

  console.log(`Finished processing ${listingsProcessed} listings.`);

  // Keep the browser open for verification (you can close it manually)
  // await browser.close();
})();
