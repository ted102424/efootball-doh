# eFootball DoH test endpoint

This project is a small DNS-over-HTTPS (DoH) **forwarder**. It accepts RFC 8484 DNS messages and forwards them to Cloudflare DNS. It does not proxy eFootball gameplay traffic, change routes, select Konami servers, or guarantee 4/5 antenna bars.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select this repository, or create a Web Service from it.
3. For a Web Service use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Set environment variable `DOH_TOKEN` to a long random string (at least 32 random characters). If using the Blueprint, Render can generate it automatically.
5. Set `UPSTREAM_DOH` to `https://cloudflare-dns.com/dns-query` (default).

After deployment, the Intra custom DoH URL is:

`https://YOUR-SERVICE.onrender.com/doh/YOUR_DOH_TOKEN`

Replace both placeholders with the actual Render hostname and the exact `DOH_TOKEN` value from the Render Environment page. Keep this URL private.

## Important limitations

- This is a baseline forwarding resolver, not the same as the Telegram/Railway service. We have not established what that service does.
- DNS can affect name resolution, but it does not tunnel or reroute the actual eFootball match packets.
- Render Free services sleep after 15 minutes without inbound traffic and can take about a minute to wake up. That makes Free Render unsuitable for consistently low-latency use.
- Test with the original working configuration and this endpoint under the same network and similar match conditions. Compare multiple League matches, not just one.
- Do not add fake DNS records or point Konami domains at guessed IP addresses.
- The endpoint is protected by a secret path and has a basic per-IP request limit. Do not publish the URL.
