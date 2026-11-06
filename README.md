# GitHub Unfollow Non-Followers (JavaScript)

A lightweight, zero-dependency JavaScript script that automatically identifies and unfollows GitHub users who do not follow you back using the official GitHub REST API and native `fetch()`.

## Features

* **Zero Dependencies:** Uses native JavaScript (`fetch` and `Set`)—no `npm install` required.
* **Fast $O(1)$ Lookup:** Uses a hash set (`Set`) to cross-reference followers and following lists instantaneously.
* **Cross-Platform:** Runs directly in your browser console (Desktop/iPad) or via Node.js (v18+).

---

## Prerequisites: Get a GitHub Personal Access Token

To allow the script to unfollow users on your behalf, you need a GitHub token with the `user:follow` permission:

1. Go to your GitHub [**Developer Settings > Personal access tokens > Tokens (classic)**](https://github.com/settings/tokens).
2. Click **Generate new token** -> **Generate new token (classic)**.
3. Give it a note (e.g., `Unfollow Script`).
4. Check the **`user:follow`** scope (under the `user` section).
5. Scroll down and click **Generate token**.
6. **Copy the token** (starts with `ghp_...`). Keep this secret!

---

## The Script (`unfollow.js`)

```javascript
const TOKEN = "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN";
const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Accept": "application/vnd.github+json",
  "User-Agent": "Unfollow-Script"
};

// Helper function to fetch ALL pages of a GitHub endpoint
async function fetchAllPages(baseUrl) {
  let allUsers = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${baseUrl}?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status} while fetching ${baseUrl}`);
    }
    const data = await res.json();
    if (data.length === 0) break; // No more pages left

    allUsers = allUsers.concat(data);
    page++;
  }
  return allUsers;
}

async function unfollowNonFollowers() {
  try {
    console.log("Fetching ALL following and followers across all pages...");

    const [following, followers] = await Promise.all([
      fetchAllPages("https://api.github.com/user/following"),
      fetchAllPages("https://api.github.com/user/followers")
    ]);

    console.log(`Total Following: ${following.length} | Total Followers: ${followers.length}\n`);

    const followerSet = new Set(followers.map(u => u.login));
    let unfollowedCount = 0;

    for (const user of following) {
      if (!followerSet.has(user.login)) {
        const res = await fetch(`https://api.github.com/user/following/${user.login}`, {
          method: "DELETE",
          headers
        });

        if (res.status === 204) {
          console.log(`[-] Unfollowed: @${user.login}`);
          unfollowedCount++;
        } else {
          console.log(`[!] Failed to unfollow @${user.login} (Status: ${res.status})`);
        }

        // Small 200ms delay so GitHub doesn't rate-limit or block rapid DELETE requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\nDone! Unfollowed ${unfollowedCount} user(s) in total.`);
  } catch (err) {
    console.error("Error running script:", err.message);
  }
}

unfollowNonFollowers();

```

---

## How to Use

### Method 1: Run in Browser Console (No Setup)
1. Open [github.com](https://github.com) in your browser.
2. Open the **Developer Console**:
   * **Windows/Linux:** Press `Ctrl + Shift + J`
   * **Mac:** Press `Cmd + Option + J`
   * **iPad / Mobile:** Use an app like **Inspect Browser**, or run the code inside an online JS runner like [PlayCode.io](https://playcode.io) or [JSFiddle](https://jsfiddle.net).
3. Replace `"YOUR_GITHUB_PERSONAL_ACCESS_TOKEN"` in the script with your actual `ghp_...` token.
4. Paste the entire script into the console and press **Enter**.

### Method 2: Run with Node.js
If you have Node.js (v18 or newer) installed:
1. Save the code above into a file named `unfollow.js`.
2. Replace `"YOUR_GITHUB_PERSONAL_ACCESS_TOKEN"` with your token.
3. Run the script from your terminal:
   ```bash
   node unfollow.js
   ```

---

## Security Warning

* **Never commit your token to a public repository.** If you push `unfollow.js` to GitHub with your `ghp_...` token inside it, GitHub will automatically revoke the token for your safety.
* Once you are done running the script, you can delete the token from your [GitHub Token Settings](https://github.com/settings/tokens) if you no longer need it.

## License

MIT License — free to use, modify, and distribute.
