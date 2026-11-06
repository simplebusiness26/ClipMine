"""Verify finished exports against the measured production timeline."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw
import soundfile as sf
import drawing

root=Path(sys.argv[1]);episodes=json.loads((root/'production.json').read_text())
results=[];panels=[]
for v in episodes:
    path=root/(v['id']+'.mp4')
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    video=next(s for s in info['streams'] if s['codec_type']=='video')
    audio=next(s for s in info['streams'] if s['codec_type']=='audio')
    assert (video['width'],video['height'],video['codec_name'],audio['codec_name'])==(1080,1920,'h264','aac')
    actual=float(info['format']['duration'])
    assert 13.5<=actual<=30 and abs(actual-v['duration'])<.15
    samples,rate=sf.read(root/(v['id']+'_mix.wav'))
    assert rate==48000 and np.max(np.abs(samples))<.99
    for index,line in enumerate(v['lines']):
        assert line['end']>line['start'] and line['end']<=v['duration']
        if index:assert line['start']>=v['lines'][index-1]['end']
        assert np.sqrt(np.mean(samples[round(line['start']*rate):round(line['end']*rate)]**2))>.01
        caption=drawing.wrap(line['text'],27,553)
        assert 970+51+len(caption)*39<1150,'Caption collides with bottom safe area'
    decoded=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','null','-'],capture_output=True,text=True,check=True)
    assert not decoded.stderr.strip()
    # Decode one frame per second. Save a compact actual-export contact sheet.
    frames=root/(v['id']+'_qa');frames.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(path),'-vf','fps=1,scale=216:384',str(frames/'%02d.jpg')],check=True)
    files=sorted(frames.glob('*.jpg'))
    assert len(files)>=int(actual)-1
    changes=[]
    for left,right in zip(files,files[1:]):
        aa=np.array(Image.open(left)).astype(float);bb=np.array(Image.open(right)).astype(float)
        changes.append(float(np.mean(abs(aa-bb))))
    assert min(changes)>.01,'Unexpected frozen second'
    sheet=Image.new('RGB',(216*4,410*((len(files)+3)//4)),(28,32,47));d=ImageDraw.Draw(sheet)
    for i,f in enumerate(files):
        x=(i%4)*216;y=(i//4)*410
        sheet.paste(Image.open(f),(x,y));d.text((x+8,y+388),str(i)+'s',fill='white')
    sheet.save(root/(v['id']+'_contact_sheet.jpg'))
    results.append({'id':v['id'],'duration':actual,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'full_decode':'passed','audio_and_video':'passed','caption_bounds':'passed','speech_intervals':'passed','sampled_motion':'passed','review_limit':'Technical and visual checks; no claim of a complete listening review.'})
(root/'verification.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
