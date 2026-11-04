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
  "Accept": "application/vnd.github+json"
};

async function unfollowNonFollowers() {
  console.log("Fetching following and followers lists...");

  const [followingRes, followersRes] = await Promise.all([
    fetch("[https://api.github.com/user/following?per_page=100](https://api.github.com/user/following?per_page=100)", { headers }),
    fetch("[https://api.github.com/user/followers?per_page=100](https://api.github.com/user/followers?per_page=100)", { headers })
  ]);

  if (!followingRes.ok || !followersRes.ok) {
    console.error("Error fetching data. Check if your Personal Access Token is valid.");
    return;
  }

  const following = await followingRes.json();
  const followers = await followersRes.json();

  const followerSet = new Set(followers.map(u => u.login));
  let unfollowedCount = 0;

  for (const user of following) {
    if (!followerSet.has(user.login)) {
      const res = await fetch(`[https://api.github.com/user/following/$](https://api.github.com/user/following/$){user.login}`, {
        method: "DELETE",
        headers
      });
      if (res.status === 204) {
        console.log(`[-] Unfollowed: @${user.login}`);
        unfollowedCount++;
      }
    }
  }

  console.log(`Done! Unfollowed ${unfollowedCount} user(s).`);
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
