"""Reusable Craig's Cartoons renderer, derived from the established Python cast.

No network calls: supply Kokoro models and optional accepted main-voice audio.
Every episode has measured dialogue, actual animated props, and an MP4 decode check.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw
import soundfile as sf
import cast as c
import drawing as p

SR = 48000
FPS = 30

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True)

def canonical(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def accepted_main(args, episodes):
    if not args.main_audio:
        return {}
    result = json.loads(Path(args.main_timings).read_text())
    pcm = args.out / 'accepted-main-pcm.wav'
    run(['ffmpeg','-v','error','-y','-i',str(args.main_audio),'-ar',str(SR),'-ac','1',str(pcm)])
    audio, rate = sf.read(pcm)
    groups, words = [], []
    for word in result['word_timestamps']:
        if word['word'].startswith('<break'):
            groups.append(words); words=[]
        elif not word['word'].startswith('<'):
            words.append(word)
    if words: groups.append(words)
    wanted = [(v['id'],i,text) for v in episodes for i,(who,text) in enumerate(v['script']) if who=='ME']
    assert len(wanted)==len(groups), 'Main voice group mismatch'
    clips={}
    for (eid,index,text), tokens in zip(wanted,groups):
        assert canonical(text)==canonical(' '.join(w['word'] for w in tokens)), 'Main voice transcript mismatch'
        start=max(0,tokens[0]['start']-.035)
        end=min(len(audio)/rate,tokens[-1]['end']+.065)
        clips[(eid,index)]=audio[round(start*rate):round(end*rate)]
    return clips

def prepare_audio(args, episodes):
    import espeakng_loader
    os.environ['PHONEMIZER_ESPEAK_LIBRARY']=espeakng_loader.get_library_path()
    os.environ['ESPEAK_DATA_PATH']=str(espeakng_loader.get_data_path())
    from kokoro_onnx import Kokoro
    from scipy.signal import resample_poly
    engine=Kokoro(str(args.assets/'kokoro-v1.0.onnx'),str(args.assets/'voices-v1.0.bin'))
    main=accepted_main(args,episodes)
    voices={'ME':'bm_lewis','COUNCIL':'bm_daniel','ROBOT':'bm_george','PIGEON':'bm_fable'}
    cache=args.out/'voices';cache.mkdir(exist_ok=True)
    for v in episodes:
        clips=[];clock=.04;v['lines']=[]
        for i,(who,text) in enumerate(v['script']):
            key=(v['id'],i)
            if key in main:
                x=main[key].copy(); source='accepted HeyGen Lewis; natural speed'
            else:
                voice=voices.get(who,'bm_george')
                digest=hashlib.sha256((text+'|'+voice+'|1.0|en-gb').encode()).hexdigest()[:16]
                path=cache/f'{v["id"]}_{i}_{digest}.wav'
                if path.exists():
                    x, rate=sf.read(path)
                else:
                    x, rate=engine.create(text,voice=voice,speed=1.0,lang='en-gb')
                    sf.write(path,x,rate)
                x=resample_poly(x,SR,rate);source='Kokoro ONNX '+voice+'; natural speed'
            ix=np.flatnonzero(abs(x)>.0025)
            if len(ix):x=x[max(0,ix[0]-round(.03*SR)):min(len(x),ix[-1]+round(.065*SR))]
            active=x[abs(x)>.012]
            rms=float(np.sqrt(np.mean(active**2))) if len(active) else .1
            x=x*min(.15/max(rms,.001),.82/max(float(np.max(abs(x))),.001))
            v['lines'].append({'start':clock,'end':clock+len(x)/SR,'who':who,'text':text,'source':source})
            clips.append((clock,x));clock+=len(x)/SR+.12
            if i==len(v['script'])-2:clock+=.13
            print('AUDIO',v['id'],i,who,round(len(x)/SR,2),flush=True)
        v['duration']=math.ceil((clock-.12+.55)*FPS)/FPS
        mix=np.zeros(round(v['duration']*SR),dtype=np.float64)
        for start,x in clips:
            off=round(start*SR);mix[off:off+len(x)]+=x
        # Original, quiet effects at visible prop changes; never underneath a consonant.
        fx=np.zeros_like(mix)
        cues=[(v['lines'][2]['start']-.075,190),(v['lines'][-1]['start']-.09,530)]
        for start,freq in cues:
            n=round(.08*SR);t=np.arange(n)/SR;off=max(0,round(start*SR))
            fx[off:off+n]+=.025*np.sin(2*np.pi*freq*t)*np.sin(np.pi*t/.08)**2
        sf.write(args.out/(v['id']+'_dialogue.wav'),mix,SR,subtype='PCM_16')
        sf.write(args.out/(v['id']+'_sfx.wav'),fx,SR,subtype='PCM_16')
        sf.write(args.out/(v['id']+'_mix.wav'),mix+fx,SR,subtype='PCM_16')
        v['_samples']=mix
    return episodes

def state(v,t):
    current=0
    for i,row in enumerate(v['lines']):
        if t>=row['start']:current=i
    row=v['lines'][current]
    off=round(t*SR);segment=v['_samples'][off:off+800]
    speaking=t<row['end'] and len(segment)>0 and float(np.sqrt(np.mean(segment**2)))>.015
    return current,row,speaking

def frame(v,t):
    idx,row,speaking=state(v,t)
    im=Image.new('RGB',(1080,1920),(31,35,55));d=ImageDraw.Draw(im)
    c.txt(d,"CRAIG'S CARTOONS",350,83,14,(175,188,208))
    for i,text in enumerate(p.wrap(v['heading'],32,600)):c.txt(d,text,350,145+i*43,32,c.CREAM)
    c.txt(d,v['sub'],350,253,18,(202,211,223))
    c.rect(d,(35,330,685,925),(65,77,94),18)
    c.rect(d,(35,818,685,925),(122,120,115),0)
    # Reused cast: mouth follows the dialogue envelope, arms and brows react to beats.
    y=564+2*math.sin(t*2.2)
    c.body(d,185,y,c.TEAL)
    c.head(d,185,y,talk=speaking and row['who']=='ME',t=t,look='shock' if idx>=4 else 'normal')
    handY=734+(12*math.sin(t*7) if row['who']=='ME' else 3*math.sin(t*2))
    c.ln(d,[(125,y+110),(95,handY)],(255,199,151),19)
    c.ln(d,[(244,y+110),(302,handY-22)],(255,199,151),19)
    # Blink independently of speech.
    if t%4.2<.11:
        for x in [161,209]:c.ln(d,[(x-10,y+8),(x+10,y+8)],c.INK,5)
    if v['scene']=='bin':
        c.rect(d,(390,602,594,886),(57,124,82),13,c.INK,4)
        for x in [425,560]:c.circ(d,x,891,19,c.INK)
        c.ln(d,[(410,645),(410,842)],(80,150,103),5)
        c.ln(d,[(575,645),(575,842)],(35,91,61),5)
        lid=0 if idx>=2 else 28+3*math.sin(t*3)
        d.polygon([p.xy(x) for x in [(380,603),(605,603-lid),(594,624-lid),(389,624)]],fill=(36,84,56),outline=c.INK,width=5)
        if idx>=2:
            progress=min(1,max(0,(t-v['lines'][2]['start'])/.28));cy=469-150*(1-progress)
            c.rect(d,(429,cy,553,cy+88),(161,111,68),6,c.INK,3)
            c.rect(d,(415,cy+88,568,cy+111),(185,138,88),5,c.INK,3)
            for x in [430,553]:c.ln(d,[(x,cy+110),(x,cy+140)],c.INK,9)
        # Council officer on the phone; a moving waveform marks the remote reply.
        c.rect(d,(405,356,624,442),(29,44,65),9,c.CREAM,2)
        c.txt(d,'COUNCIL',514,383,17,c.CREAM)
        for j in range(8):
            amp=3+(10*abs(math.sin(t*18+j)) if row['who']=='COUNCIL' and speaking else 1)
            c.ln(d,[(447+j*19,419-amp),(447+j*19,419+amp)],c.PINK,4)
        if idx>=5:
            c.rect(d,(344,725,646,782),(233,206,144),4,c.INK,3)
            c.txt(d,'PERMIT REQUIRED',495,754,20,c.INK)
    elif v['scene']=='robot':
        # The hoover cleans one outlined square, then asserts its boundary.
        c.rect(d,(357,698,640,881),(159,177,183),1,c.CREAM,2)
        moving=t<v['lines'][1]['start'];rx=490+(65*math.sin(t*2) if moving else 0)
        d.ellipse(p.xy((rx-89,739,rx+89,841)),fill=(36,43,60),outline=c.CREAM,width=5)
        c.rect(d,(rx-56,757,rx+56,808),(70,138,151),12)
        for ex in [rx-23,rx+23]:c.circ(d,ex,777,6,c.CREAM)
        if row['who']=='ROBOT' and speaking:c.rect(d,(rx-11,788,rx+11,798),c.INK,3)
        else:c.ln(d,[(rx-12,793),(rx+12,793)],c.INK,3)
        for j in range(14):
            cx=330+(j*71)%300;cy=859+(j*17)%42
            c.circ(d,cx,cy,3,(229,193,125))
        c.rect(d,(431,465,606,560),(188,194,201),14,c.INK,4)
        c.ln(d,[(459,481),(574,481)],c.INK,6)
        c.circ(d,581,523,6,(215,96,106))
        if idx>=1:
            c.rect(d,(387,629,642,680),c.CREAM,5,c.INK,3);c.txt(d,'ON MY BREAK',514,655,21,c.INK)
        if idx>=5:
            c.rect(d,(388,363,655,414),c.PINK,4,c.INK,3);c.txt(d,'SHOP STEWARD ↑',521,389,18,c.INK)
            # Toaster lever reacts to being named.
            c.ln(d,[(612,505),(630,505+8*math.sin(t*12))],c.INK,5)
    else:
        c.rect(d,(330,741,662,783),(176,122,84),4,c.INK,4)
        for x in [350,641]:c.ln(d,[(x,783),(x,915)],c.INK,11)
        c.rect(d,(363,564,495,719),(44,51,73),5,c.CREAM,3)
        c.rect(d,(350,714,511,735),(139,154,170),3,c.INK,2)
        # Pigeon bobs, pecks, flaps and delivers the final report.
        bob=6*math.sin(t*5);px=566;py=626+bob
        d.ellipse(p.xy((px-58,py-16,px+54,py+90)),fill=(146,153,169),outline=c.INK,width=5)
        wing=12*math.sin(t*9) if row['who']=='PIGEON' else 2*math.sin(t*2)
        d.ellipse(p.xy((px-25,py+13,px+61,py+64+wing)),fill=(104,119,148),outline=c.INK,width=4)
        c.circ(d,px+4,py-33,39,(129,144,156),c.INK,3)
        c.circ(d,px+17,py-44,8,(244,183,79),c.INK,2);c.circ(d,px+19,py-44,3,c.INK)
        beak=8 if row['who']=='PIGEON' and speaking else 1
        d.polygon([p.xy(x) for x in [(px+32,py-32-beak),(px+70,py-23),(px+32,py-20+beak)]],fill=(219,184,93),outline=c.INK)
        for x in [px-18,px+19]:c.ln(d,[(x,py+80),(x+5,738)],(223,155,133),6)
        if idx<2:
            c.rect(d,(512,445,636,532),c.CREAM,2,c.INK,2)
            for yy in [467,489,511]:c.ln(d,[(530,yy),(615,yy)],c.INK,3)
            c.txt(d,'TO DO',574,422,16,c.CREAM)
        else:
            for j in range(7):
                xx=520+(j*19)%111;yy=500+(j*37)%190
                c.rect(d,(xx,yy,xx+15,yy+7),c.CREAM,0)
        if idx>=4:
            d.ellipse(p.xy((400,617,449,644)),fill=(241,238,206),outline=c.INK,width=2)
            c.txt(d,'PROGRESS REPORT',492,386,20,c.PINK)
    # Caption timing uses measured speech intervals, held through short reply gaps.
    rows=p.wrap(row['text'],27,553);height=51+len(rows)*39
    c.rect(d,(65,970,635,970+height),c.CREAM,14,c.INK,3)
    c.txt(d,row['who'],350,994,13,(118,74,113))
    for j,text in enumerate(rows):c.txt(d,text,350,1033+j*39,27,c.INK)
    c.ln(d,[(83,1174),(617,1174)],(103,119,145),3)
    c.ln(d,[(83,1174),(83+534*t/v['duration'],1174)],c.TEAL,3)
    return im

def render(args,v,smoke=False):
    name=v['id']+('_smoke' if smoke else '')
    duration=min(5,v['duration']) if smoke else v['duration']
    dest=args.out/(name+'.mp4')
    cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size','1080x1920','-framerate',str(FPS),'-i','pipe:0','-i',str(args.out/(v['id']+'_mix.wav')),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','160k','-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),'-movflags','+faststart']
    if smoke:cmd+=['-t',str(duration)]
    cmd+=[str(dest)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    for f in range(round(duration*FPS)):
        proc.stdin.write(frame(v,f/FPS).tobytes())
    proc.stdin.close()
    if proc.wait()!=0:raise RuntimeError('FFmpeg render failed')
    run(['ffmpeg','-v','error','-i',str(dest),'-f','null','-'])
    info=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(dest)]).stdout)
    video=next(s for s in info['streams'] if s['codec_type']=='video')
    assert (video['width'],video['height'])==(1080,1920)
    assert any(s['codec_type']=='audio' for s in info['streams'])
    assert abs(float(info['format']['duration'])-duration)<.15
    print('VERIFIED MP4',dest,info['format']['duration'],flush=True)
    return info

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--episodes',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--assets',type=Path,required=True)
    ap.add_argument('--main-audio',type=Path)
    ap.add_argument('--main-timings',type=Path)
    ap.add_argument('--audio-only',action='store_true')
    ap.add_argument('--smoke',action='store_true')
    args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    episodes=prepare_audio(args,json.loads(args.episodes.read_text()))
    for v in episodes:
        if not args.audio_only:
            if args.smoke:render(args,v,True)
            else:render(args,v)
        for t in [0,v['duration']*.45,v['lines'][-1]['start']+.1]:
            frame(v,t).resize((540,960)).save(args.out/(v['id']+f'_preview_{t:.2f}.jpg'))
    clean=[{k:val for k,val in v.items() if not k.startswith('_')} for v in episodes]
    (args.out/'production.json').write_text(json.dumps(clean,indent=2))

if __name__=='__main__':main()
