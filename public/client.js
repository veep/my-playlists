$( document ).ready(function() {
  $(".track-star").click(function() {
    var rating = $(this).data('rating');
    var track_id = $(this).data('trackid');
    if (rating) {
       $.ajax({
         type: "POST",
         url: "/postrating",
         data: { track_id: track_id, rating: rating},
       });
       $(this).parent().children(".track-star").each(function() {
         if ($(this).data('rating') <= rating) {
           $(this).children(".fa-star").addClass("fas").removeClass("far");
         } else {
           $(this).children(".fa-star").addClass("far").removeClass("fas");
         }  
       });
    }                                           
  }); 
  $(".preview-button").click(function(e) {
       e.preventDefault();

       // This next line will get the audio element
       // that is adjacent to the link that was clicked.
       var song = $(this).next('audio').get(0);
       if (song.paused) {
         $('audio').each(function() {this.pause();});
         song.play();
       } else {
         song.pause();
       }
     });
  $('audio').on('pause play',function(e) {
    var button = $(this).prev('span').contents();
    if (e.type == 'play') {
      button.addClass('fa-pause-circle').removeClass('fa-play-circle');
    } else if (e.type == 'pause') {
      button.addClass('fa-play-circle').removeClass('fa-pause-circle');
    }
  });
}); 