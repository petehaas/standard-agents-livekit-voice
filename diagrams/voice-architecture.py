"""Draws diagrams/voice-architecture.svg. Run: python3 diagrams/voice-architecture.py diagrams/voice-architecture.svg
Then rasterize the SVG to voice-architecture.png at 2400 px wide (any SVG renderer)."""
import sys
W,H=2400,1760
out=[]
def a(s): out.append(s)
ORANGE=('#fdf1e4','#b8732e'); TEAL=('#e6f4f4','#2e8a8f'); IND=('#eceef9','#4b54a8'); NEU=('#ffffff','#7a7f99')
FONT="font-family='-apple-system, Helvetica Neue, Helvetica, Arial, sans-serif'"
def box(x,y,w,h,col,title,lines,ts=40,ls=29):
    a(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='26' fill='{col[0]}' stroke='{col[1]}' stroke-width='4'/>")
    n=len(lines); cy=y+h/2-(n*ls*1.55)/2
    a(f"<text x='{x+w/2}' y='{cy+8}' text-anchor='middle' font-size='{ts}' font-weight='700' fill='#1b1b1f'>{title}</text>")
    for i,l in enumerate(lines):
        a(f"<text x='{x+w/2}' y='{cy+ts*0.4+ (i+1)*ls*1.55}' text-anchor='middle' font-size='{ls}' fill='#2b2b33'>{l}</text>")
def tag(x,y,text,col,anchor='start'):
    w=len(text)*12.2+36
    x0 = x if anchor=='start' else x-w/2
    a(f"<rect x='{x0}' y='{y-24}' width='{w}' height='36' rx='18' fill='#ffffff' stroke='{col}' stroke-width='2'/>")
    a(f"<text x='{x0+w/2}' y='{y+1}' text-anchor='middle' font-size='21' font-weight='600' fill='{col}'>{text}</text>")
def arrow(pts,dashed=False,color='#4a4a52'):
    d='M'+' L'.join(f'{px},{py}' for px,py in pts)
    da=" stroke-dasharray='14 10'" if dashed else ''
    a(f"<path d='{d}' fill='none' stroke='{color}' stroke-width='4'{da} marker-end='url(#ah{'d' if dashed else ''})'/>")
def badge(x,y,n,col):
    a(f"<circle cx='{x}' cy='{y}' r='21' fill='{col}'/><text x='{x}' y='{y+9}' text-anchor='middle' font-size='25' font-weight='700' fill='#fff'>{n}</text>")
def label(x,y,n,col,lines,bg=False):
    badge(x,y,n,col)
    for i,l in enumerate(lines):
        if bg:
            w=len(l)*14.5+16
            a(f"<rect x='{x+30}' y='{y-24+i*36}' width='{w}' height='34' fill='#ffffff'/>")
        a(f"<text x='{x+36}' y='{y+9+i*36}' font-size='28' fill='#2b2b33'>{l}</text>")
def note(x,y,lines,col='#4b54a8',size=26,weight='400'):
    for i,l in enumerate(lines):
        a(f"<text x='{x}' y='{y+i*36}' font-size='{size}' font-weight='{weight}' fill='{col}'>{l}</text>")

a(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {W} {H}' width='{W}' height='{H}' {FONT}>")
a("<defs><marker id='ah' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M0,0 L10,5 L0,10 z' fill='#4a4a52'/></marker>"
  "<marker id='ahd' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M0,0 L10,5 L0,10 z' fill='#b8732e'/></marker></defs>")
a(f"<rect width='{W}' height='{H}' fill='#ffffff'/>")
a(f"<text x='{W/2}' y='76' text-anchor='middle' font-size='54' font-weight='700' fill='#1b1b1f'>One voice turn, start to finish</text>")

# Top row
box(100,170,560,240,ORANGE,'Support desk',["caller's browser","mic · orb · captions · cards"])
box(860,170,560,240,TEAL,'LiveKit room',['WebRTC','audio, video, data, RPC'])
box(1660,170,620,240,TEAL,'Execution host',['Node · Silero VAD','end of turn · barge-in'])
tag(380,150,'demo','#b8732e','mid')
tag(1970,150,'@petehaas/standard-agents-livekit-host','#2e8a8f','mid')

arrow([(660,250),(856,250)]); label(722,225,1,'#b8732e',['voice'])
arrow([(1420,250),(1656,250)]); label(1482,225,2,'#2e8a8f',['audio'])
arrow([(1660,330),(1424,330)]); label(1482,388,11,'#2e8a8f',['voice'])
arrow([(860,330),(664,330)]); label(722,388,12,'#2e8a8f',['hear'])

# Runtime container
a("<rect x='60' y='560' width='2280' height='1140' rx='34' fill='#f5f6fc' stroke='#4b54a8' stroke-width='4' stroke-dasharray='18 12'/>")
note(110,626,['Standard Agents Builder runtime · Cloudflare Workers'],size=34,weight='700')
note(110,670,['Standard Agent Specification 0.2.0'],size=27)

# The Standard Agent: both sides plus the thread between them
a("<rect x='80' y='770' width='2240' height='360' rx='28' fill='#e3e6f6' stroke='#4b54a8' stroke-width='3'/>")
a("<text x='1140' y='808' text-anchor='middle' font-size='30' font-weight='700' fill='#4b54a8'>Standard Agent · voice_concierge</text>")
a("<text x='1140' y='1118' text-anchor='middle' font-size='22' fill='#4b54a8'>one agent, two sides that only exchange text (demo)</text>")

box(100,840,560,260,IND,'Side A · prompt',['order_support','reply model + tools: look up,','track, change, return'],ts=38,ls=26)
box(880,840,520,240,NEU,'Thread messages',['the only link','between the sides'],ts=36)
box(1660,840,600,260,IND,'Side B · handler',['voice_caller · no model','the only part with audio','from the voice package'],ts=38,ls=26)

# voice package: side B's handler and the speech services
a("<rect x='1600' y='1150' width='720' height='500' rx='26' fill='none' stroke='#4b54a8' stroke-width='3' stroke-dasharray='6 8'/>")
box(1640,1300,300,240,IND,'Speech to text',['Deepgram (live)','or OpenAI'],ts=32,ls=26)
box(1980,1300,300,240,IND,'Text to speech',['Deepgram, OpenAI,','or ElevenLabs'],ts=32,ls=26)
a("<text x='1790' y='1580' text-anchor='middle' font-size='22' fill='#2b2b33'>4  transcribe, live</text><text x='2130' y='1580' text-anchor='middle' font-size='22' fill='#2b2b33'>9  synthesize, streamed</text>")
tag(1960,1650,'@petehaas/standard-agents-livekit-voice','#4b54a8','mid')

# host <-> side B (runtime streams)
arrow([(1860,410),(1860,836)]); label(1892,470,3,'#2e8a8f',['listen','16 kHz'],bg=True)
arrow([(2140,836),(2140,414)]); label(2172,470,10,'#4b54a8',['speak','24 kHz'],bg=True)
a("<rect x='1636' y='676' width='650' height='34' fill='#f5f6fc'/>")
note(1648,702,['3 and 10 are runtime streams (PCM)'],col='#2b2b33',size=24)

# B <-> thread
arrow([(1660,920),(1404,920)]); badge(1430,880,5,'#4b54a8')
arrow([(1400,1020),(1656,1020)]); badge(1430,1060,8,'#4b54a8')
# thread <-> A
arrow([(880,920),(664,920)]); badge(700,880,6,'#4b54a8')
arrow([(660,1020),(876,1020)]); badge(700,1060,7,'#4b54a8')
note(130,1180,['5  caller’s words, as side B’s message   ·   6  side A’s turn','7  reply text   ·   8  side B’s turn: speak the reply'],col='#2b2b33',size=24)

# B <-> STT / TTS
arrow([(1740,1100),(1740,1296)]); arrow([(1840,1296),(1840,1104)]); badge(1760,1225,4,'#4b54a8')
arrow([(2080,1100),(2080,1296)]); arrow([(2180,1296),(2180,1104)]); badge(2100,1225,9,'#4b54a8')

# cards path (dashed)
arrow([(600,840),(600,736),(1440,736),(1440,480),(1700,480),(1700,414)],dashed=True,color='#b8732e')
note(630,722,['tool cards: livekit.show stream → host → show_card RPC → desk'],col='#b8732e',size=22)

# spec note
a("<rect x='100' y='1290' width='1380' height='190' rx='20' fill='#ffffff' stroke='#c9cce3' stroke-width='2'/>")
note(130,1340,['Spec surface the voice package uses (ThreadState):'],col='#1b1b1f',size=26,weight='700')
note(130,1384,['runtime streams · thread messages · thread values · env'],col='#2b2b33',size=26)
note(130,1428,['Capability names (livekit.*) are this repo’s proposal. The spec keeps them'],col='#5a5d70',size=23)
note(130,1460,['opaque and does not yet define how an execution host attaches.'],col='#5a5d70',size=23)

a("</svg>")
open(sys.argv[1],'w').write('\n'.join(out))
