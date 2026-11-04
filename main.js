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
