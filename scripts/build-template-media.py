"""Build original illustrated starter animatics. No downloaded or generated media.
Requires Pillow and the repository's ffmpeg-static executable. Output is bundled
so users need neither Python nor provider credentials to preview/edit samples.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, pathlib, subprocess, json
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/templates'
OUT.mkdir(exist_ok=True)
FFMPEG = ROOT / 'node_modules/ffmpeg-static/ffmpeg'
FPS = 24
names = ['blue-hour','product','daily-story','rhythm','field-notes','explain','conversation','playground']

def mix(a,b,t): return tuple(round(x+(y-x)*t) for x,y in zip(a,b))
def gradient(size,top,bottom):
    im=Image.new('RGB',size);d=ImageDraw.Draw(im)
    for y in range(size[1]): d.line((0,y,size[0],y),fill=mix(top,bottom,y/size[1]))
    return im

def render(name,shot,t):
    # Work in a consistent illustrated 640 x 400 space; frame to the project shape.
    size=(640,400)
    colors={ 'blue-hour':((33,43,76),(222,160,139)), 'product':((66,82,76),(195,193,160)),
    'daily-story':((235,188,113),(237,215,173)), 'rhythm':((20,23,46),(61,41,81)),
    'field-notes':((100,143,147),(216,212,167)), 'explain':((209,212,231),(235,222,213)),
    'conversation':((83,108,103),(185,174,144)), 'playground':((206,216,147),(243,218,154)) }
    im=gradient(size,*colors[name]);d=ImageDraw.Draw(im)
    phase=(shot+t)/4
    if name in ['blue-hour','field-notes']:
        sun=(478-shot*26,110+18*t)
        d.ellipse((sun[0]-32,sun[1]-32,sun[0]+32,sun[1]+32),fill=(250,218,174))
        for layer in range(4):
            y=190+layer*48
            pts=[(-40,440)]+[(x,y+math.sin(x/90+layer*2+t*.18)*28+math.cos(x/56+layer)*13) for x in range(-40,701,8)]+[(700,440)]
            shade=((76-layer*14,86-layer*13,110-layer*15) if name=='blue-hour' else (119-layer*25,139-layer*24,107-layer*18))
            d.polygon(pts,fill=shade)
        if name=='field-notes':
            d.polygon([(180,400),(320,245),(370,248),(550,400)],fill=(130,164,159))
            for y in range(265,400,10):
                x=320-(y-265)*.7
                d.line((x+math.sin(t*5+y)*8,y,x+(y-230)*.7,y),fill=(195,202,172),width=2)
        else:
            d.polygon([(230,400),(350,258),(357,259),(303,400)],fill=(146,118,128))
            x=352+shot*3;y=252
            d.ellipse((x-4,y-6,x+4,y+2),fill=(255,228,165))
            d.line((x,y+2,x,y+15),fill=(31,33,53),width=3)
            if shot==2:
                glow=Image.new('RGBA',size);g=ImageDraw.Draw(glow);g.ellipse((260,180,380,300),fill=(255,199,100,100));glow=glow.filter(ImageFilter.GaussianBlur(28));im=Image.alpha_composite(im.convert('RGBA'),glow).convert('RGB');d=ImageDraw.Draw(im)
                d.ellipse((305,220,335,250),fill=(255,226,157))
    elif name=='product':
        d.polygon([(0,295),(640,254),(640,400),(0,400)],fill=(166,171,146))
        cx=320+math.sin(t*math.pi)*12
        shadow=Image.new('RGBA',size);sd=ImageDraw.Draw(shadow);sd.ellipse((cx-90,296,cx+130,324),fill=(30,45,40,90));shadow=shadow.filter(ImageFilter.GaussianBlur(15));im=Image.alpha_composite(im.convert('RGBA'),shadow).convert('RGB');d=ImageDraw.Draw(im)
        for x in range(-48,49):
            brightness=(math.cos(x/65)+math.sin(x/33+t*.5)*.1)
            d.line((cx+x,145,cx+x,300),fill=mix((32,67,55),(146,171,133),max(0,min(1,brightness-.2))))
        d.ellipse((cx-48,131,cx+48,159),fill=(158,182,143));d.ellipse((cx-48,286,cx+48,314),fill=(64,99,76))
        d.rounded_rectangle((cx-28,115,cx+28,139),radius=6,fill=(35,62,50));d.line((cx-24,122,cx+22,122),fill=(194,201,156),width=2)
        d.rectangle((cx-26,190,cx+26,242),fill=(219,218,187));d.line((cx-12,208,cx+12,208),fill=(65,86,66),width=2);d.ellipse((cx-6,219,cx+6,231),outline=(65,86,66),width=2)
        if shot==1: im=im.crop((220,110,420,310)).resize(size,Image.Resampling.LANCZOS)
        if shot==2: im=im.crop((205,150,475,320)).resize(size,Image.Resampling.LANCZOS)
    elif name=='daily-story':
        d.rectangle((40,35,600,330),fill=(242,226,191));d.line((40,230,600,230),fill=(210,185,143),width=2)
        for x in [125,320,515]:d.line((x,35,x,330),fill=(225,202,165),width=2)
        d.ellipse((210,295,440,330),fill=(205,180,132))
        cx=320;cy=218
        for petal in range(8):
            a=petal*math.tau/8+t*.12
            rad=48+shot*7+math.sin(t*3)*4
            x=cx+math.cos(a)*rad;y=cy+math.sin(a)*rad
            d.ellipse((x-29,y-29,x+29,y+29),fill=(226,102+petal*6,62))
        d.line((cx,cy,cx,309),fill=(83,107,61),width=8)
        d.ellipse((cx-48,261,cx,283),fill=(117,139,70));d.ellipse((cx,277,cx+45,299),fill=(144,156,74))
        d.ellipse((cx-26,cy-26,cx+26,cy+26),fill=(248,196,66))
    elif name=='rhythm':
        glow=Image.new('RGBA',size);g=ImageDraw.Draw(glow)
        for i in range([1,3,7,2][shot]):
            r=45+i*18+math.sin(t*math.tau-i*.8)*12
            x=320+math.sin(t*2+i)*i*13;y=200+math.cos(t*2+i)*i*8
            color=[(189,160,241),(239,151,187),(125,202,210)][i%3]
            g.ellipse((x-r,y-r,x+r,y+r),outline=(*color,85),width=12)
            d.ellipse((x-r,y-r,x+r,y+r),outline=color,width=3)
        glow=glow.filter(ImageFilter.GaussianBlur(18));im=Image.alpha_composite(im.convert('RGBA'),glow).convert('RGB')
    elif name=='explain':
        d.line((90,310,550,310),fill=(175,177,194),width=2)
        positions=[(190,230),(320,190),(450,230)]
        for i,(x,y) in enumerate(positions):
            if shot>=2: x=x+(320-x)*(.55 if shot==3 else t*.55)
            y+=math.sin(t*3+i)*7
            col=[(129,133,184),(204,150,169),(108,160,174)][i]
            if i==0:d.rounded_rectangle((x-42,y-42,x+42,y+42),radius=14,fill=col)
            elif i==1:d.ellipse((x-45,y-45,x+45,y+45),fill=col)
            else:d.polygon([(x,y-49),(x-49,y+38),(x+49,y+38)],fill=col)
            if shot==1 and i==1:d.ellipse((x-58,y-58,x+58,y+58),outline=(245,241,231),width=3)
    elif name=='conversation':
        d.rectangle((48,35,243,235),fill=(210,218,187));d.rectangle((65,51,224,217),fill=(150,182,166));d.line((145,51,145,217),fill=(218,216,188),width=5);d.line((65,135,224,135),fill=(218,216,188),width=5)
        d.polygon([(0,280),(640,280),(640,400),(0,400)],fill=(140,136,112))
        for x,col in [(200,(180,142,103)),(445,(121,145,117))]:
            d.rounded_rectangle((x-47,190,x+47,285),radius=24,fill=col);d.rounded_rectangle((x-55,250,x+55,297),radius=13,fill=col)
            d.line((x-37,286,x-48,342),fill=(55,67,60),width=6);d.line((x+37,286,x+48,342),fill=(55,67,60),width=6)
        d.ellipse((282,259,364,279),fill=(63,80,69));d.line((323,279,323,331),fill=(63,80,69),width=5)
        d.line((270,285,269,225),fill=(52,65,59),width=3);d.rounded_rectangle((262,208,276,235),radius=6,fill=(43,58,51))
        if shot in [1,2]:im=im.crop((80 if shot==1 else 280,90,380 if shot==1 else 580,360)).resize(size,Image.Resampling.LANCZOS)
    else:
        for i in range(1 if shot in [0,3] else 3):
            a=t*math.tau*.4+i*math.tau/3
            x=320+(math.cos(a)*100 if i else 0);y=235-math.sin(t*math.pi)*45+(math.sin(a)*32 if i else -35)
            r=48 if i==0 else 26
            d.ellipse((x-r,308-r*.15,x+r,308+r*.15),fill=(185,180,119))
            for radius in range(r,0,-1):
                color=mix([(226,114,65),(136,157,83),(65,105,95)][i],[(255,204,111),(211,220,131),(153,191,149)][i],(1-radius/r)*.85)
                d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=color)
            d.ellipse((x-r*.4,y-r*.55,x-r*.15,y-r*.3),fill=(249,221,152))
    # Gentle shot-specific reframing is visible even in still studies.
    if name in ['blue-hour','field-notes'] and shot in [1,3]:
        z=1.08+.05*t;x=(640-640/z)/2;y=(400-400/z)/2
        im=im.crop((x,y,640-x,400-y)).resize(size,Image.Resampling.LANCZOS)
    if name=='daily-story':im=im.crop((190,0,415,400)).resize((360,640),Image.Resampling.LANCZOS)
    elif name=='playground':im=im.crop((120,0,520,400)).resize((480,480),Image.Resampling.LANCZOS)
    else:im=im.resize((640,360),Image.Resampling.LANCZOS)
    return im

for name in names:
    poster=render(name,0,.45);poster.save(OUT/f'{name}.jpg',quality=90)
    width,height=poster.size
    for shot in range(4):
        cmd=[str(FFMPEG),'-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-s',f'{width}x{height}','-pix_fmt','rgb24','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','24','-profile:v','baseline','-level','3.0','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/f'{name}-{shot+1}.mp4')]
        child=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        for frame in range(FPS*5):child.stdin.write(render(name,shot,frame/(FPS*5)).tobytes())
        child.stdin.close()
        if child.wait():raise RuntimeError(name)
    listing=OUT/f'{name}.concat.txt';listing.write_text('\n'.join(f"file '{name}-{i+1}.mp4'" for i in range(4)))
    subprocess.run([str(FFMPEG),'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(OUT/f'{name}.mp4')],check=True)
    listing.unlink()
    print(name,flush=True)
