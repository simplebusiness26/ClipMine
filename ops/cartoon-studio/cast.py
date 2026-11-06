import math
import drawing as p
CREAM=(255,242,213);INK=(29,26,47);PINK=(255,143,177);TEAL=(53,188,178)
def txt(d,s,x,y,n=30,c=CREAM):p.text(d,s,x,y,n,c)

def ln(d,pts,c,w=3):p.line(d,pts,c,w)

def rect(d,b,fill,r=0,outline=None,w=2):d.rounded_rectangle(p.xy(b),radius=round(r*p.S),fill=fill,outline=outline,width=round(w*p.S))

def circ(d,x,y,r,c,outline=None,w=2):p.circle(d,x,y,r,c,outline,w)

def head(d,x,y,kind='me',talk=False,t=0,look='normal',scale=1):
 # Hand-built expressive cartoon cast; no outside visual assets.
 col=(255,199,151) if kind=='me' else (198,157,240) if kind=='brain' else (237,177,135)
 if kind=='brain':
  for ox,oy,r in [(-39,0,40),(0,-24,43),(37,0,40),(-20,30,34),(25,30,34)]:circ(d,x+ox,y+oy,r,PINK,INK,3)
  for ox in [-28,8,36]:ln(d,[(x+ox,y-30),(x+ox-9,y-13),(x+ox+3,y+2)],(199,78,127),3)
 else:
  rect(d,(x-66,y-64,x+66,y+75),col,40,INK,4)
  if kind=='me':
   d.polygon([p.xy(z) for z in [(x-66,y-25),(x-65,y-64),(x-20,y-80),(x+22,y-61),(x+65,y-71),(x+62,y-23),(x+32,y-44),(x+7,y-25),(x-20,y-42)]],fill=INK)
  else:
   rect(d,(x-70,y-70,x+70,y-43),INK,8)
   circ(d,x+40,y-64,23,INK)
 ey=y+8
 if look=='tired':
  for ex in [x-24,x+24]:ln(d,[(ex-11,ey),(ex+11,ey+2)],INK,4)
 elif look=='shock':
  for ex in [x-24,x+24]:circ(d,ex,ey,16,CREAM,INK,3);circ(d,ex,ey,5,INK)
 else:
  for ex in [x-24,x+24]:circ(d,ex,ey,6,INK)
  ln(d,[(x-37,ey-21),(x-13,ey-25)],INK,3)
  ln(d,[(x+13,ey-25),(x+37,ey-21)],INK,3)
 if talk and math.sin(t*28)>-.25:
  rect(d,(x-13,y+32,x+13,y+48+6*math.sin(t*24)),INK,7)
 else:ln(d,[(x-12,y+39),(x+12,y+40)],INK,3)

def body(d,x,y,col=TEAL):
 rect(d,(x-75,y+65,x+75,y+255),col,28,INK,4)
 ln(d,[(x-52,y+250),(x-60,y+310)],INK,17);ln(d,[(x+52,y+250),(x+65,y+310)],INK,17)
