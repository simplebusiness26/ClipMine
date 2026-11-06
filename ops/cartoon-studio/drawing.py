from PIL import ImageFont
S=1.5
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
WHITE=(239,245,255)
fonts={}
def font(n,bold=True):
 key=(n,bold)
 if key not in fonts: fonts[key]=ImageFont.truetype(FONT if bold else REG,round(n*S))
 return fonts[key]

def xy(p): return tuple(round(v*S) for v in p)

def line(d,points,fill,width=2):d.line([xy(p) for p in points],fill=fill,width=round(width*S))

def circle(d,x,y,r,fill,outline=None,width=2): d.ellipse(xy((x-r,y-r,x+r,y+r)),fill=fill,outline=outline,width=round(width*S))

def text(d,txt,x,y,size=30,fill=WHITE,anchor='mm',bold=True): d.text(xy((x,y)),txt,font=font(size,bold),fill=fill,anchor=anchor)

def wrap(txt,size=24,width=570):
 words=txt.split(); lines=[]; s=''
 for w in words:
  q=(s+' '+w).strip()
  if font(size).getlength(q)>width*S and s:lines.append(s);s=w
  else:s=q
 if s:lines.append(s)
 return lines
